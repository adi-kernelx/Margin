/**
 * Ingest Router - Page-level OCR Job Ingestion
 * 
 * Handles enqueueing OCR jobs to SQS with:
 * - Ownership validation
 * - Idempotency checks (S3 HEAD)
 * - Canonical message contract
 * - Sync mode for testing
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../../middleware/auth';
import { s3, sqs, S3_BUCKET, AWS_REGION } from '../../lib/storage';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { SendMessageCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { findFileDocByOwnerAndId } from '../../lib/firestore-helpers';
import { processOCRJob } from '../../lib/ocr-vision';
import htrRouter from './htr';
import embedRouter from './embed';

const router = Router();
router.use('/htr', htrRouter);
router.use('/embed', embedRouter);

const QUEUE_NAME = process.env.OCR_QUEUE_NAME || 'ocr-page-ingest';
let QUEUE_URL = process.env.OCR_QUEUE_URL || '';

/**
 * Canonical SQS Message Contract (Step 3.3)
 * This is the frozen contract - do not change casually
 */
export interface OCRPageJobMessage {
    jobType: 'OCR_PAGE';
    requestId: string;           // UUID v4 - unique per enqueue attempt
    userId: string;
    docId: string;
    page: number;
    pageKey: string;             // S3 key: users/UID/docs/DID/pages/page-0001.png
    pdfKey: string;              // S3 key: users/UID/docs/DID/original.pdf
    pdfHash: string;             // SHA256 hex of original PDF
    dpr: number;                 // Device pixel ratio used for rendering
    mimeType: string;            // image/png or image/jpeg
    visionFeature: string;       // DOCUMENT_TEXT_DETECTION or TEXT_DETECTION
    requestedAt: string;         // ISO8601 timestamp
    force: boolean;              // If true, bypass idempotency
    ocrVersion: number;          // Schema version for evolution
}

/**
 * POST /api/ingest/page
 * 
 * Enqueues a page for OCR processing.
 * Query params:
 *   - sync=true: Process immediately (for testing, not production)
 * 
 * Returns 202 Accepted with { jobEnqueued, requestId } or { status: "already_processed" }
 */
router.post('/page', requireAuth, async (req, res) => {
    const requestId = uuidv4();
    const startTime = Date.now();

    try {
        const uid = req.user!.uid;
        const {
            docId,
            page,
            pageKey,
            pdfKey,
            pdfHash,
            dpr = 2,
            mimeType = 'image/png',
            force = false,
            ocrVersion = 1,
            visionFeature = 'DOCUMENT_TEXT_DETECTION'
        } = req.body;

        const syncMode = req.query.sync === 'true' || req.body.sync === true;

        // 1. Basic Validation
        if (!docId || page === undefined || !pageKey || !pdfKey) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['docId', 'page', 'pageKey', 'pdfKey']
            });
        }

        // Validate page number
        const pageNum = parseInt(page, 10);
        if (isNaN(pageNum) || pageNum < 1) {
            return res.status(400).json({ error: 'Invalid page number' });
        }

        // 2. Validate Page Key Prefix (Security - prevent path traversal)
        const expectedPrefix = `users/${uid}/docs/${docId}/pages/`;
        if (!pageKey.startsWith(expectedPrefix)) {
            console.warn(`[Ingest] Invalid pageKey prefix: ${pageKey}, expected: ${expectedPrefix}`);
            return res.status(403).json({ error: 'Invalid page key path' });
        }

        // 3. Verify Ownership (Existence + Access)
        const fileDoc = await findFileDocByOwnerAndId(uid, docId);
        if (!fileDoc || !fileDoc.exists) {
            return res.status(404).json({ error: 'Document not found' });
        }

        // 4. Idempotency Check (S3 HEAD - cheap)
        const ocrKey = pageKey.replace('/pages/', '/ocr/').replace(/\.(png|jpg|jpeg)$/i, '.json');

        if (!force) {
            try {
                await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: ocrKey }));
                // Sidecar exists - skip enqueue
                console.log(`[Ingest] Already processed: ${ocrKey}`);
                return res.status(202).json({
                    status: 'already_processed',
                    requestId,
                    ocrKey,
                    processingTimeMs: Date.now() - startTime
                });
            } catch (e: any) {
                // 404 means not processed yet - continue
                if (e.name !== 'NotFound' && e.name !== 'NoSuchKey' && e.$metadata?.httpStatusCode !== 404) {
                    console.warn(`[Ingest] Idempotency check error: ${e.message}`);
                }
            }
        }

        // 5. Build canonical message (Step 3.3 Contract)
        const jobMessage: OCRPageJobMessage = {
            jobType: 'OCR_PAGE',
            requestId,
            userId: uid,
            docId,
            page: pageNum,
            pageKey,
            pdfKey,
            pdfHash: pdfHash || 'unknown',
            dpr: Number(dpr) || 2,
            mimeType,
            visionFeature,
            requestedAt: new Date().toISOString(),
            force: !!force,
            ocrVersion: Number(ocrVersion) || 1
        };

        // 6. Sync Mode: Process immediately (for testing/debugging)
        if (syncMode) {
            console.log(`[Ingest] SYNC processing page ${pageNum} of doc ${docId} (requestId: ${requestId})`);

            // Convert to legacy format for processOCRJob
            const result = await processOCRJob({
                jobType: 'OCR_PAGE',
                userId: uid,
                docId,
                page: pageNum,
                pageKey,
                pdfKey,
                pdfHash: pdfHash || 'unknown',
                dpr: Number(dpr) || 2,
                force: !!force,
                ocrVersion: Number(ocrVersion) || 1
            }, `sync-${requestId}`);

            if (result.success) {
                return res.status(200).json({
                    status: result.skipped ? 'already_processed' : 'processed',
                    requestId,
                    processingTimeMs: Date.now() - startTime
                });
            } else {
                return res.status(500).json({
                    error: result.error || 'OCR processing failed',
                    requestId
                });
            }
        }

        // 7. Async Mode: Enqueue to SQS
        if (!QUEUE_URL) {
            try {
                const qRes = await sqs.send(new GetQueueUrlCommand({ QueueName: QUEUE_NAME }));
                if (qRes.QueueUrl) QUEUE_URL = qRes.QueueUrl;
            } catch (e) {
                console.error('[Ingest] Failed to get Queue URL:', e);
                return res.status(503).json({
                    error: 'Queue unavailable',
                    requestId
                });
            }
        }

        const sqsResult = await sqs.send(new SendMessageCommand({
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify(jobMessage),
            MessageAttributes: {
                'requestId': { DataType: 'String', StringValue: requestId },
                'docId': { DataType: 'String', StringValue: docId },
                'page': { DataType: 'Number', StringValue: String(pageNum) }
            }
        }));

        console.log(`[Ingest] Enqueued: requestId=${requestId}, docId=${docId}, page=${pageNum}, sqsMessageId=${sqsResult.MessageId}`);

        res.status(202).json({
            status: 'queued',
            jobEnqueued: true,
            requestId,
            sqsMessageId: sqsResult.MessageId,
            processingTimeMs: Date.now() - startTime
        });

    } catch (err: any) {
        console.error(`[Ingest] Failed (requestId=${requestId}):`, err);
        res.status(500).json({
            error: 'Ingest failed',
            requestId,
            details: err.message
        });
    }
});

/**
 * POST /api/ingest/batch
 * 
 * Enqueue multiple pages at once (for bulk processing after PDF upload)
 */
router.post('/batch', requireAuth, async (req, res) => {
    const batchId = uuidv4();
    const startTime = Date.now();

    try {
        const uid = req.user!.uid;
        const { docId, pages, pdfKey, pdfHash, dpr = 2, force = false } = req.body;

        if (!docId || !pages || !Array.isArray(pages) || pages.length === 0) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['docId', 'pages (array)', 'pdfKey']
            });
        }

        // Verify ownership
        const fileDoc = await findFileDocByOwnerAndId(uid, docId);
        if (!fileDoc || !fileDoc.exists) {
            return res.status(404).json({ error: 'Document not found' });
        }

        // Get queue URL
        if (!QUEUE_URL) {
            const qRes = await sqs.send(new GetQueueUrlCommand({ QueueName: QUEUE_NAME }));
            if (qRes.QueueUrl) QUEUE_URL = qRes.QueueUrl;
        }

        const results: { page: number; status: string; requestId?: string }[] = [];
        const prefix = `users/${uid}/docs/${docId}`;

        for (const pageNum of pages) {
            const requestId = uuidv4();
            const pageKey = `${prefix}/pages/page-${String(pageNum).padStart(4, '0')}.png`;
            const ocrKey = `${prefix}/ocr/page-${String(pageNum).padStart(4, '0')}.json`;

            // Idempotency check
            if (!force) {
                try {
                    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: ocrKey }));
                    results.push({ page: pageNum, status: 'already_processed' });
                    continue;
                } catch (e: any) {
                    if (e.name !== 'NotFound' && e.name !== 'NoSuchKey' && e.$metadata?.httpStatusCode !== 404) {
                        console.warn(`[Ingest:Batch] Idempotency check error for page ${pageNum}`);
                    }
                }
            }

            // Enqueue
            const jobMessage: OCRPageJobMessage = {
                jobType: 'OCR_PAGE',
                requestId,
                userId: uid,
                docId,
                page: pageNum,
                pageKey,
                pdfKey: pdfKey || `${prefix}/original.pdf`,
                pdfHash: pdfHash || 'unknown',
                dpr: Number(dpr) || 2,
                mimeType: 'image/png',
                visionFeature: 'DOCUMENT_TEXT_DETECTION',
                requestedAt: new Date().toISOString(),
                force: !!force,
                ocrVersion: 1
            };

            await sqs.send(new SendMessageCommand({
                QueueUrl: QUEUE_URL,
                MessageBody: JSON.stringify(jobMessage)
            }));

            results.push({ page: pageNum, status: 'queued', requestId });
        }

        const queued = results.filter(r => r.status === 'queued').length;
        const skipped = results.filter(r => r.status === 'already_processed').length;

        console.log(`[Ingest:Batch] batchId=${batchId}, docId=${docId}, queued=${queued}, skipped=${skipped}`);

        res.status(202).json({
            status: 'batch_complete',
            batchId,
            queued,
            skipped,
            results,
            processingTimeMs: Date.now() - startTime
        });

    } catch (err: any) {
        console.error(`[Ingest:Batch] Failed (batchId=${batchId}):`, err);
        res.status(500).json({ error: 'Batch ingest failed', batchId });
    }
});

/**
 * POST /api/ingest/test-ocr
 * Test endpoint for OCR without strict validation (dev only)
 */
router.post('/test-ocr', requireAuth, async (req, res) => {
    try {
        const uid = req.user!.uid;
        const { imageKey } = req.body;

        if (!imageKey) {
            return res.status(400).json({ error: 'Missing imageKey' });
        }

        console.log(`[TestOCR] Testing OCR on: ${imageKey}`);

        const result = await processOCRJob({
            jobType: 'OCR_PAGE',
            userId: uid,
            docId: 'test-doc',
            page: 1,
            pageKey: imageKey,
            pdfKey: 'test.pdf',
            pdfHash: 'test',
            dpr: 1,
            force: true,
            ocrVersion: 1
        }, `test-${Date.now()}`);

        if (result.success) {
            res.json({ ok: true, result });
        } else {
            res.status(500).json({ error: result.error });
        }

    } catch (err: any) {
        console.error('[TestOCR] Failed:', err);
        res.status(500).json({ error: err.message || 'Test failed' });
    }
});

export default router;
