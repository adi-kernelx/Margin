
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { findFileDocByOwnerAndId } from '../lib/firestore-helpers';
import { sqs } from '../lib/storage';
import { SendMessageCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import { OCRPageJobMessage } from './ingest';
import {
    getManifest,
    saveManifest,
    OCRManifest,
    CURRENT_OCR_VERSION,
    MANIFEST_FILE_Name
} from '../lib/ocr-vision';

const router = Router();
const QUEUE_NAME = process.env.OCR_QUEUE_NAME || 'ocr-page-ingest';
let QUEUE_URL = process.env.OCR_QUEUE_URL || '';

/**
 * POST /api/docs/:docId/ocr/start
 * 
 * Idempotent start/check for OCR.
 */
router.post('/docs/:docId/ocr/start', requireAuth, async (req, res) => {
    const { docId } = req.params;
    const uid = req.user!.uid;
    const { pdfHash } = req.body; // Optional: caller can provide expected hash

    try {
        // 1. Verify ownership/existence
        const fileDoc = await findFileDocByOwnerAndId(uid, docId);
        if (!fileDoc || !fileDoc.exists) {
            return res.status(404).json({ error: 'Document not found' });
        }
        const fileData = fileDoc.data();
        const pageCount = fileData?.pageCount || 0; // Ensure we have pageCount

        const manifestKey = `users/${uid}/docs/${docId}/${MANIFEST_FILE_Name}`;

        // 2. Load manifest
        let manifest = await getManifest(manifestKey);

        // 3. Determine if we need to run OCR
        let needsRun = false;

        // If manifest missing, we must create it and run
        if (!manifest) {
            needsRun = true;
            // Create initial manifest
            manifest = {
                docId,
                userId: uid,
                pdfHash: pdfHash || 'unknown', // Best effort if missing
                pageCount,
                ocr: {
                    version: CURRENT_OCR_VERSION,
                    status: 'not_started',
                    pagesCompleted: 0,
                    totalPages: pageCount,
                    completedPages: [] // Initialize for tracking
                }
            };
        } else {
            // Check if stale
            const versionMatch = manifest.ocr.version === CURRENT_OCR_VERSION;
            const hashMatch = !pdfHash || manifest.pdfHash === pdfHash; // If pdfHash provided, check it
            const isComplete = manifest.ocr.status === 'complete';

            if (versionMatch && hashMatch && isComplete) {
                return res.json({
                    status: 'already_complete',
                    job: {
                        totalPages: manifest.ocr.totalPages,
                        pagesCompleted: manifest.ocr.pagesCompleted
                    }
                });
            }

            if (!versionMatch || !hashMatch || manifest.ocr.status === 'failed') {
                needsRun = true;
            } else if (manifest.ocr.status === 'running') {
                // Already running, just return status
                return res.json({
                    status: 'running',
                    job: {
                        totalPages: manifest.ocr.totalPages,
                        pagesCompleted: manifest.ocr.pagesCompleted
                    }
                });
            } else if (manifest.ocr.status === 'not_started') {
                needsRun = true;
            }
        }

        if (needsRun) {
            // Update manifest to running
            manifest.ocr.status = 'running';
            manifest.ocr.pagesCompleted = 0;
            manifest.ocr.totalPages = pageCount;
            manifest.ocr.lastRunAt = new Date().toISOString();
            manifest.ocr.completedPages = []; // Reset progress

            // If hash was provided and we are re-running, update it (assuming file changed)
            if (pdfHash && manifest.pdfHash !== pdfHash) {
                manifest.pdfHash = pdfHash;
            }
            // Ensure version is current
            manifest.ocr.version = CURRENT_OCR_VERSION;

            await saveManifest(manifestKey, manifest);

            // Enqueue pages
            if (!QUEUE_URL) {
                const qRes = await sqs.send(new GetQueueUrlCommand({ QueueName: QUEUE_NAME }));
                if (qRes.QueueUrl) QUEUE_URL = qRes.QueueUrl;
            }

            // Send messages in parallel (or batch)
            const prefix = `users/${uid}/docs/${docId}`;
            const pdfKey = `${prefix}/original.pdf`;

            const promises = [];
            for (let i = 1; i <= pageCount; i++) {
                const requestId = uuidv4();
                const pageKey = `${prefix}/pages/page-${String(i).padStart(4, '0')}.png`;

                const jobMessage: OCRPageJobMessage = {
                    jobType: 'OCR_PAGE',
                    requestId,
                    userId: uid,
                    docId,
                    page: i,
                    pageKey,
                    pdfKey,
                    pdfHash: manifest.pdfHash,
                    dpr: 2, // Default
                    mimeType: 'image/png',
                    visionFeature: 'DOCUMENT_TEXT_DETECTION',
                    requestedAt: new Date().toISOString(),
                    force: true, // Force reprocessing since orchestrator decided to run
                    ocrVersion: 1 // Keep msg version 1 as per strict contract? Or match? User said msg ocrVersion: 'v1' but msg uses number.
                    // Existing OCRPageJobMessage defines ocrVersion: number.
                    // I'll leave it as 1.
                };

                promises.push(
                    sqs.send(new SendMessageCommand({
                        QueueUrl: QUEUE_URL,
                        MessageBody: JSON.stringify(jobMessage),
                        MessageAttributes: {
                            'requestId': { DataType: 'String', StringValue: requestId },
                            'docId': { DataType: 'String', StringValue: docId },
                            'page': { DataType: 'Number', StringValue: String(i) }
                        }
                    }))
                );
            }

            await Promise.all(promises);

            return res.json({
                status: 'started',
                job: {
                    totalPages: pageCount,
                    pagesCompleted: 0
                }
            });
        }

        // Should not reach here
        res.status(500).json({ error: 'Unexpected state' });

    } catch (err: any) {
        console.error('[OCR Start] Failed for doc:', { docId, error: err.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/docs/:docId/ocr/status
 * 
 * Poll progress from manifest.
 */
router.get('/docs/:docId/ocr/status', requireAuth, async (req, res) => {
    const { docId } = req.params;
    const uid = req.user!.uid;

    try {
        const manifestKey = `users/${uid}/docs/${docId}/${MANIFEST_FILE_Name}`;
        const manifest = await getManifest(manifestKey);

        if (!manifest) {
            return res.json({
                status: 'not_started',
                pagesCompleted: 0,
                totalPages: 0
            });
        }

        res.json({
            status: manifest.ocr.status,
            pagesCompleted: manifest.ocr.pagesCompleted,
            totalPages: manifest.ocr.totalPages
        });

    } catch (err: any) {
        console.error(`[OCR Status] Failed for doc ${docId}:`, err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
