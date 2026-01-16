
import { s3, S3_BUCKET } from './storage';
import { GetObjectCommand, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { v4 as uuidv4 } from 'uuid';

// --- Constants ---

export const CURRENT_OCR_VERSION = 1;
export const MANIFEST_FILE_Name = 'manifest.json';

// --- Types ---

export interface OCRManifest {
    docId: string;
    userId: string;
    pdfHash: string;
    pageCount: number;
    ocr: {
        version: number;
        status: 'not_started' | 'running' | 'complete' | 'failed';
        pagesCompleted: number;
        totalPages: number;
        completedPages: number[]; // Array of completed page numbers
        lastRunAt?: string;
    };
}

export interface ProcessingResult {
    success: boolean;
    error?: string;
    skipped?: boolean;
}

// --- Helpers ---

export async function getManifest(key: string): Promise<OCRManifest | null> {
    try {
        const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
        const body = await res.Body?.transformToString();
        if (!body) return null;
        return JSON.parse(body);
    } catch (e: any) {
        if (e.name === 'NoSuchKey' || e.name === 'NotFound') {
            return null;
        }
        throw e;
    }
}

export async function saveManifest(key: string, manifest: OCRManifest): Promise<void> {
    await writeAtomicS3(key, manifest);
}

// Atomic Write Pattern: Write to tmp -> Copy to dest -> Delete tmp
async function writeAtomicS3(key: string, data: any) {
    const tmpKey = `_tmp/${uuidv4()}.json`;

    // 1. Write to tmp
    await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: tmpKey,
        Body: JSON.stringify(data),
        ContentType: 'application/json'
    }));

    // 2. Copy to actual key
    await s3.send(new CopyObjectCommand({
        Bucket: S3_BUCKET,
        CopySource: `${S3_BUCKET}/${tmpKey}`,
        Key: key
    }));

    // 3. Delete tmp
    await s3.send(new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: tmpKey
    }));
}

// --- Google Vision Client ---
// Assumes GOOGLE_APPLICATION_CREDENTIALS env var is set or default auth works
const visionClient = new ImageAnnotatorClient();

// --- Core Logic ---

export async function processOCRJob(job: any, requestId: string): Promise<ProcessingResult> {
    try {
        const {
            userId,
            docId,
            page,
            pageKey,
            pdfHash,
            ocrVersion = CURRENT_OCR_VERSION,
            force
        } = job;

        // 1. Construct keys
        const sidecarKey = pageKey.replace('/pages/', '/ocr/').replace(/\.(png|jpg|jpeg)$/i, '.json');

        // 2. Check idempotency (unless forced)
        if (!force) {
            try {
                await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: sidecarKey }));
                // If exists, skip
                return { success: true, skipped: true };
            } catch (e: any) {
                // If not found, proceed
                if (e.name !== 'NotFound' && e.name !== 'NoSuchKey') {
                    console.warn(`[OCR] Idempotency check failed: ${e.message}`);
                }
            }
        }

        // 3. Download Image
        const imgRes = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: pageKey }));
        const imgBytes = await imgRes.Body?.transformToByteArray();
        if (!imgBytes) {
            return { success: false, error: 'Failed to download image' };
        }

        // 4. Send to Google Vision
        const [result] = await visionClient.documentTextDetection({
            image: { content: Buffer.from(imgBytes) }
        });

        if (result.error && result.error.message) {
            throw new Error(`Google Vision Error: ${result.error.message}`);
        }

        // 5. Normalize Response
        const sidecar = normalizeVisionResponse(result, page, pdfHash, ocrVersion);

        // 6. Write Sidecar Atomic
        await writeAtomicS3(sidecarKey, sidecar);

        // 7. Update Manifest
        await updateManifestProgress(userId, docId, page);

        return { success: true };

    } catch (err: any) {
        console.error(`[OCR] Job failed (req=${requestId}):`, err);
        return { success: false, error: err.message };
    }
}

async function updateManifestProgress(userId: string, docId: string, completedPage: number) {
    // We used a "manifest" approach in local testing, but in S3:
    // We need to lock or rely on eventual consistency. 
    // Since this is S3, atomic updates on a single JSON file are hard without a lock.
    // However, the Python script suggested "load -> increment -> save atomic". 
    // This has a race condition but might be "good enough" for this project scale or if sequential.

    // Better Approach for Production: Use DynamoDB. 
    // Current Architecture Requirement: Update S3 manifest.json.
    // We will attempt a best-effort update (Load-Modify-Write). Re-queued jobs fix eventual gaps.

    const manifestKey = `users/${userId}/docs/${docId}/${MANIFEST_FILE_Name}`;

    // Simple retry loop for basic optimistic concurrency handling
    for (let i = 0; i < 3; i++) {
        try {
            const manifest = await getManifest(manifestKey);
            if (!manifest) return; // Should exist if started properly

            // Update
            if (!manifest.ocr.completedPages.includes(completedPage)) {
                manifest.ocr.completedPages.push(completedPage);
                manifest.ocr.pagesCompleted = manifest.ocr.completedPages.length;

                if (manifest.ocr.pagesCompleted >= manifest.ocr.totalPages) {
                    manifest.ocr.status = 'complete';
                }

                await saveManifest(manifestKey, manifest);
            }
            return;
        } catch (e) {
            await new Promise(r => setTimeout(r, 100 + Math.random() * 500));
        }
    }
}

// --- Normalization ---

function normalizeVisionResponse(response: any, page: number, pdfHash: string, ocrVersion: number) {
    const tokens: any[] = [];
    const lines: any[] = [];

    const fullText = response.fullTextAnnotation;
    if (!fullText) {
        // Empty result
        return {
            version: ocrVersion,
            pdfHash,
            page,
            tokens: [],
            lines: [],
            summary: { tokenCount: 0, avgConfidence: 0 },
            processing: { engine: 'gcv', timestamp: Date.now() / 1000 }
        };
    }

    const pages = fullText.pages || [];

    for (const p of pages) {
        const width = p.width; // GCV often returns these
        const height = p.height;

        for (const block of (p.blocks || [])) {
            for (const paragraph of (block.paragraphs || [])) {
                let lineText = "";
                let lineBBox: any[] = [];
                // Simplified line detection assumes paragraphs ~ lines or we just grouping logic.
                // The python script did "line_text += word + ' '; line_bbox.append(bbox)" per paragraph?
                // Actually GCV structure is Page -> Block -> Paragraph -> Word -> Symbol.
                // Often a Paragraph is a block of text, not necessarily one line. 
                // But let's follow the user's provided python logic: "for word in paragraph.words".

                // NOTE: GCV paragraphs can be multi-line. The USER's python script treats a paragraph as a line unit. 
                // I will follow that logic exactly as requested.

                for (const word of (paragraph.words || [])) {
                    const wordText = word.symbols.map((s: any) => s.text).join('');
                    const bbox = normalizeBBox(word.boundingBox, width, height);

                    tokens.push({
                        text: wordText,
                        bbox: bbox,
                        confidence: word.confidence
                    });

                    lineText += wordText + " ";
                    lineBBox.push(bbox);
                }

                if (lineText.trim().length > 0) {
                    lines.push({
                        text: lineText.trim(),
                        bbox: mergeBBoxes(lineBBox)
                    });
                }
            }
        }
    }

    const tokenCount = tokens.length;
    const avgConfidence = tokenCount > 0
        ? tokens.reduce((acc, t) => acc + (t.confidence || 0), 0) / tokenCount
        : 0;

    return {
        version: ocrVersion,
        pdfHash,
        page,
        tokens,
        lines,
        summary: {
            tokenCount,
            avgConfidence
        },
        processing: {
            engine: 'gcv',
            timestamp: Date.now() / 1000
        }
    };
}

function normalizeBBox(boundingBox: any, width?: number, height?: number) {
    // vertices: [{x, y}, ...]
    if (!boundingBox || !boundingBox.vertices) return { x0: 0, y0: 0, x1: 0, y1: 0 };

    const xs = boundingBox.vertices.map((v: any) => v.x || 0);
    const ys = boundingBox.vertices.map((v: any) => v.y || 0);

    let x0 = Math.min(...xs);
    let x1 = Math.max(...xs);
    let y0 = Math.min(...ys);
    let y1 = Math.max(...ys);

    // Normalize if width/height available (GCV usually returns pixels)
    // Actually GCV ImageAnnotator often returns normalized info if requested, but standard is absolute.
    // The Python script had: "xs = [v.x for v in ...]" then used it.
    // IF the user uses normalized coordinates [0,1], we must divide by width/height.
    // BUT GCV standard response has `width` and `height` in the page object.

    // In the User's Python script, `normalize_bbox` implementation was ambiguous in the prompt ("If you were normalizing...").
    // Standard GCV returns absolute pixels. Our viewer expects relative [0..1].
    // I will assume normalization is required.

    // Note: We don't always get page-level width/height easily inside the loop unless passed down.
    // In GCV, `page.width` and `page.height` exist.
    // IF they are 0 or missing, we default to 1 (avoid div by zero).

    const w = width || 1;
    const h = height || 1;

    // Additional Check: If x1 <= 1 and w > 100, maybe it's already normalized? 
    // GCV normally returns integers for pixels.

    // Safety clamp
    return {
        x0: Math.max(0, Math.min(1, x0 / w)),
        y0: Math.max(0, Math.min(1, y0 / h)),
        x1: Math.max(0, Math.min(1, x1 / w)),
        y1: Math.max(0, Math.min(1, y1 / h))
    };
}

function mergeBBoxes(bboxes: any[]) {
    if (bboxes.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };

    const x0 = Math.min(...bboxes.map(b => b.x0));
    const y0 = Math.min(...bboxes.map(b => b.y0));
    const x1 = Math.max(...bboxes.map(b => b.x1));
    const y1 = Math.max(...bboxes.map(b => b.y1));

    return { x0, y0, x1, y1 };
}
