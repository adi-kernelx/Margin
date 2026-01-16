
import json
import boto3
import os
import datetime
import uuid
import logging
from botocore.exceptions import ClientError

# Init
logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client('s3')
textract = boto3.client('textract')

S3_BUCKET = os.environ.get('S3_BUCKET')

def lambda_handler(event, context):
    logger.info(f"Received event: {json.dumps(event)}")
    
    # SQS sends 'Records' list
    for record in event.get('Records', []):
        try:
            body = json.loads(record['body'])
            process_message(body, context)
        except Exception as e:
            logger.error(f"Failed to process record: {e}", exc_info=True)
            raise e # Raise to ensuring DLQ logic if persistent failure

    return {'statusCode': 200}

def process_message(msg, context):
    # 4.3 Input Contract Validation
    if msg.get('jobType') != 'OCR_PAGE':
        logger.warning(f"Invalid jobType {msg.get('jobType')}, ignoring.")
        return
        
    doc_id = msg['docId']
    user_id = msg['userId']
    page_num = msg['page']
    page_key = msg['pageKey']
    force = msg.get('force', False)
    
    # Construct OCR output key
    # users/{UID}/docs/{DID}/ocr/page-0001.json
    output_key = page_key.replace('/pages/', '/ocr/').replace('.png', '.json')
    
    # 4.4 Idempotency Check
    if not force:
        try:
            s3.head_object(Bucket=S3_BUCKET, Key=output_key)
            logger.info(f"OCR already exists for {output_key}, skipping.")
            return
        except ClientError as e:
            if e.response['Error']['Code'] not in ['404', 'NoSuchKey', 'NotFound']:
                raise e

    # 4.5 Call Textract
    logger.info(f"Calling Textract DetectDocumentText for {page_key}")
    response = textract.detect_document_text(
        Document={'S3Object': {'Bucket': S3_BUCKET, 'Name': page_key}}
    )
    
    # 4.6 Normalize Output
    started_at = datetime.datetime.utcnow().isoformat()
    # Assume synchronous means completed now
    completed_at = datetime.datetime.utcnow().isoformat()
    
    normalized_data = normalize_textract(response, msg, context, started_at, completed_at)
    
    # 4.7 Write Sidecar
    s3.put_object(
        Bucket=S3_BUCKET,
        Key=output_key,
        Body=json.dumps(normalized_data),
        ContentType='application/json'
    )
    logger.info(f"Wrote OCR sidecar to {output_key}")
    
    # 4.8 Update Manifest (Minimal)
    update_manifest(user_id, doc_id, page_num, normalized_data['summary'])


def normalize_textract(textract_resp, msg, context, started, completed):
    blocks = textract_resp['Blocks']
    lines = []
    tokens = []
    
    # Stats
    total_conf = 0.0
    token_count = 0
    
    # Mapping IDs to our simplified IDs if needed, but keeping Textract IDs inside metadata is safer
    # We will generate simple IDs: l-001, t-001
    
    line_idx = 0
    token_idx = 0
    
    block_map = {b['Id']: b for b in blocks}

    for b in blocks:
        if b['BlockType'] == 'LINE':
            line_idx += 1
            l_id = f"l-{line_idx:04d}"
            
            # Textract Geometry is 0..1 relative
            bbox = b['Geometry']['BoundingBox']
            
            line_obj = {
                "id": l_id,
                "text": b['Text'],
                "confidence": b['Confidence'],
                "bbox": {
                    "l": bbox['Left'],
                    "t": bbox['Top'],
                    "w": bbox['Width'],
                    "h": bbox['Height']
                },
                "tokenIds": [] # Will fill below
            }
            
            # Find children (WORDS)
            if 'Relationships' in b:
                for rel in b['Relationships']:
                    if rel['Type'] == 'CHILD':
                        for child_id in rel['Ids']:
                            child = block_map.get(child_id)
                            if child and child['BlockType'] == 'WORD':
                                token_idx += 1
                                t_id = f"t-{token_idx:04d}"
                                
                                # Token
                                child_bbox = child['Geometry']['BoundingBox']
                                token_obj = {
                                    "id": t_id,
                                    "lineId": l_id,
                                    "text": child['Text'],
                                    "confidence": child['Confidence'],
                                    "bbox": {
                                        "l": child_bbox['Left'],
                                        "t": child_bbox['Top'],
                                        "w": child_bbox['Width'],
                                        "h": child_bbox['Height']
                                    }
                                }
                                tokens.append(token_obj)
                                line_obj['tokenIds'].append(t_id)
                                
                                total_conf += child['Confidence']
                                token_count += 1
                                
            lines.append(line_obj)

    avg_conf = (total_conf / token_count) if token_count > 0 else 0.0

    return {
        "docId": msg['docId'],
        "page": msg['page'],
        "sourceImageKey": msg['pageKey'],
        "source": "aws-textract",
        "processing": {
            "startedAt": started,
            "completedAt": completed,
            "status": "success",
            "workerId": context.aws_request_id,
            "version": 1
        },
        "summary": {
            "avgConfidence": round(avg_conf / 100.0, 4), # Normalize 0-100 to 0-1
            "handwritingDetected": False,
            "handwritingConfidence": 0,
            "tokensCount": token_count
        },
        "lines": lines,
        "tokens": tokens
    }

def update_manifest(uid, doc_id, page_num, summary):
    manifest_key = f"users/{uid}/docs/{doc_id}/manifest.json"
    
    try:
        # Read
        try:
            resp = s3.get_object(Bucket=S3_BUCKET, Key=manifest_key)
            manifest = json.loads(resp['Body'].read())
        except ClientError as e:
            if e.response['Error']['Code'] in ['404', 'NoSuchKey', 'NotFound']:
                # Should exist from upload, but safe fallback
                manifest = {"docId": doc_id, "ocr": {"pages": {}}}
            else:
                logger.warning(f"Failed to read manifest for {doc_id}: {e}")
                return

        # Update
        if 'ocr' not in manifest: manifest['ocr'] = {}
        if 'pages' not in manifest['ocr']: manifest['ocr']['pages'] = {}
        
        manifest['ocr']['pages'][str(page_num)] = {
            "status": "completed",
            "avgConfidence": summary['avgConfidence'],
            "handwritingDetected": summary['handwritingDetected'],
            "updatedAt": datetime.datetime.utcnow().isoformat()
        }
        manifest['lastUpdated'] = datetime.datetime.utcnow().isoformat()
        
        # Write back
        s3.put_object(
            Bucket=S3_BUCKET,
            Key=manifest_key,
            Body=json.dumps(manifest),
            ContentType='application/json'
        )
        logger.info(f"Updated manifest for page {page_num}")
        
    except Exception as e:
        logger.error(f"Failed manifest update: {e}")
        # Non-critical failure, don't throw
