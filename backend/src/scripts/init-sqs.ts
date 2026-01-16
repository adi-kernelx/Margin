/**
 * SQS Queue Initialization Script
 * 
 * Creates:
 *   - ocr-page-ingest (main queue)
 *   - ocr-page-ingest-dlq (dead-letter queue)
 *   - htr-page-ingest (HTR queue)
 *   - htr-page-ingest-dlq (HTR DLQ)
 * 
 * Run: npx ts-node src/scripts/init-sqs.ts
 */

import {
    SQSClient,
    CreateQueueCommand,
    GetQueueAttributesCommand,
    SetQueueAttributesCommand,
    GetQueueUrlCommand
} from '@aws-sdk/client-sqs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const region = process.env.AWS_REGION || 'ap-south-1';
const MAIN_QUEUE_NAME = 'ocr-page-ingest';
const DLQ_NAME = 'ocr-page-ingest-dlq';
const HTR_QUEUE_NAME = 'htr-page-ingest';
const HTR_DLQ_NAME = 'htr-page-ingest-dlq';
const EMBED_PAGE_QUEUE_NAME = 'embedding-page-ingest';
const EMBED_PAGE_DLQ_NAME = 'embedding-page-ingest-dlq';
const EMBED_BATCH_QUEUE_NAME = 'embedding-batch-ingest';
const EMBED_BATCH_DLQ_NAME = 'embedding-batch-ingest-dlq';

const sqs = new SQSClient({
    region,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
    }
});

async function createQueueIfNotExists(queueName: string, attributes: Record<string, string>) {
    console.log(`\nCreating Queue: ${queueName}...`);
    try {
        const res = await sqs.send(new CreateQueueCommand({
            QueueName: queueName,
            Attributes: attributes
        }));
        console.log(`   ✅ URL: ${res.QueueUrl}`);
        return res.QueueUrl;
    } catch (err: any) {
        if (err.name === 'QueueNameExists' || err.Code === 'QueueAlreadyExists') {
            const urlRes = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
            console.log(`   ℹ️ Exists: ${urlRes.QueueUrl}`);
            return urlRes.QueueUrl;
        }
        throw err;
    }
}

async function getQueueArn(queueUrl: string) {
    const attrRes = await sqs.send(new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['QueueArn']
    }));
    return attrRes.Attributes?.QueueArn;
}

async function main() {
    console.log(`[Init-SQS] Configuring queues in ${region}...`);

    try {
        // --- OCR Queues ---
        const ocrDlqUrl = await createQueueIfNotExists(DLQ_NAME, {
            MessageRetentionPeriod: '1209600', // 14 days
            SqsManagedSseEnabled: 'true'
        });
        const ocrDlqArn = await getQueueArn(ocrDlqUrl!);

        const ocrUrl = await createQueueIfNotExists(MAIN_QUEUE_NAME, {
            VisibilityTimeout: '300', // 5 mins
            MessageRetentionPeriod: '345600', // 4 days
            ReceiveMessageWaitTimeSeconds: '20',
            DelaySeconds: '0',
            RedrivePolicy: JSON.stringify({ deadLetterTargetArn: ocrDlqArn, maxReceiveCount: 5 }),
            SqsManagedSseEnabled: 'true'
        });

        // --- HTR Queues (Step 5) ---
        const htrDlqUrl = await createQueueIfNotExists(HTR_DLQ_NAME, {
            MessageRetentionPeriod: '1209600', // 14 days
            SqsManagedSseEnabled: 'true'
        });
        const htrDlqArn = await getQueueArn(htrDlqUrl!);

        // HTR inference is slow, set visibility timeout higher (e.g., 10 mins)
        const htrUrl = await createQueueIfNotExists(HTR_QUEUE_NAME, {
            VisibilityTimeout: '600',
            MessageRetentionPeriod: '345600',
            ReceiveMessageWaitTimeSeconds: '20',
            RedrivePolicy: JSON.stringify({
                deadLetterTargetArn: htrDlqArn,
                maxReceiveCount: 3 // Retry less often for expensive GPU tasks
            }),
            SqsManagedSseEnabled: 'true'
        });

        // --- Embedding Queues (Step 6) ---
        // 1. Page Ingest (Chunker)
        const embedPageDlqUrl = await createQueueIfNotExists(EMBED_PAGE_DLQ_NAME, {
            MessageRetentionPeriod: '1209600',
            SqsManagedSseEnabled: 'true'
        });
        const embedPageDlqArn = await getQueueArn(embedPageDlqUrl!);

        const embedPageUrl = await createQueueIfNotExists(EMBED_PAGE_QUEUE_NAME, {
            VisibilityTimeout: '120', // Chunker is fast
            MessageRetentionPeriod: '345600',
            ReceiveMessageWaitTimeSeconds: '20',
            RedrivePolicy: JSON.stringify({ deadLetterTargetArn: embedPageDlqArn, maxReceiveCount: 3 }),
            SqsManagedSseEnabled: 'true'
        });

        // 2. Batch Ingest (Embedder)
        const embedBatchDlqUrl = await createQueueIfNotExists(EMBED_BATCH_DLQ_NAME, {
            MessageRetentionPeriod: '1209600',
            SqsManagedSseEnabled: 'true'
        });
        const embedBatchDlqArn = await getQueueArn(embedBatchDlqUrl!);

        const embedBatchUrl = await createQueueIfNotExists(EMBED_BATCH_QUEUE_NAME, {
            VisibilityTimeout: '300', // Embedding APIs might throttle
            MessageRetentionPeriod: '345600',
            ReceiveMessageWaitTimeSeconds: '20',
            RedrivePolicy: JSON.stringify({ deadLetterTargetArn: embedBatchDlqArn, maxReceiveCount: 5 }),
            SqsManagedSseEnabled: 'true'
        });

        // Summary
        console.log('\n' + '='.repeat(60));
        console.log('SQS CONFIGURATION COMPLETE');
        console.log('='.repeat(60));
        console.log(`OCR Queue URL:         ${ocrUrl}`);
        console.log(`HTR Queue URL:         ${htrUrl}`);
        console.log(`Embed Page Queue:      ${embedPageUrl}`);
        console.log(`Embed Batch Queue:     ${embedBatchUrl}`);
        console.log('='.repeat(60));
        console.log('\nAdd to your .env:');
        console.log(`OCR_QUEUE_URL=${ocrUrl}`);
        console.log(`HTR_QUEUE_URL=${htrUrl}`);
        console.log(`EMBED_PAGE_QUEUE_URL=${embedPageUrl}`);
        console.log(`EMBED_BATCH_QUEUE_URL=${embedBatchUrl}`);

    } catch (err: any) {
        console.error('Failed to setup SQS:', err);
    }
}

main();
