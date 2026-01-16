/**
 * HTR Ingest Router
 * 
 * Handles HTR-related job triggering.
 * - POST /reprocess: Manually enqueue a page for HTR
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../../middleware/auth';
import { sqs, s3, S3_BUCKET } from '../../lib/storage';
import { SendMessageCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { findFileDocByOwnerAndId } from '../../lib/firestore-helpers';

const router = Router();
const HTR_QUEUE_NAME = process.env.HTR_QUEUE_NAME || 'htr-page-ingest';
let HTR_QUEUE_URL = process.env.HTR_QUEUE_URL || '';

/**
 * HTR SQS Message Contract
 */
interface HTRPageJobMessage {
    jobType: 'HTR_PAGE';
    requestId: string;
    userId: string;
    docId: string;
    page: number;
    pageKey: string;
    sidecarKey: string;
    reason: string;
    force: boolean;
    htrVersion: number;
    requestedAt: string;
}

/**
 * POST /api/ingest/htr/reprocess
 * 
 * Manually trigger HTR for a page.
 * Body: { docId, page, reason? }
 */
router.post('/reprocess', requireAuth, async (req, res) => {
    const requestId = uuidv4();
    try {
        const uid = req.user!.uid;
        const { docId, page, reason = 'manual' } = req.body;

        if (!docId || page === undefined) {
            return res.status(400).json({ error: 'Missing docId or page' });
        }

        // 1. Verify Ownership
        const fileDoc = await findFileDocByOwnerAndId(uid, docId);
        if (!fileDoc || !fileDoc.exists) {
            return res.status(404).json({ error: 'Document not found' });
        }

        const pageNum = parseInt(page, 10);
        const prefix = `users/${uid}/docs/${docId}`;
        const pageKey = `${prefix}/pages/page-${String(pageNum).padStart(4, '0')}.png`;
        const sidecarKey = `${prefix}/ocr/page-${String(pageNum).padStart(4, '0')}.json`;

        // 2. Check if Sidecar Exists (Prerequisite)
        try {
            await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: sidecarKey }));
        } catch (e: any) {
            if (e.name === 'NotFound' || e.name === 'NoSuchKey') {
                return res.status(400).json({ error: 'OCR sidecar not found. Run OCR first.' });
            }
            throw e;
        }

        // 3. Get Queue URL
        if (!HTR_QUEUE_URL) {
            try {
                const qRes = await sqs.send(new GetQueueUrlCommand({ QueueName: HTR_QUEUE_NAME }));
                if (qRes.QueueUrl) HTR_QUEUE_URL = qRes.QueueUrl;
            } catch (e) {
                console.error('[HTR] Failed to get queue URL:', e);
                return res.status(503).json({ error: 'HTR Queue unavailable' });
            }
        }

        // 4. Enqueue Message
        const jobMessage: HTRPageJobMessage = {
            jobType: 'HTR_PAGE',
            requestId,
            userId: uid,
            docId,
            page: pageNum,
            pageKey,
            sidecarKey,
            reason,
            force: true, // Manual triggers are usually forced
            htrVersion: 1,
            requestedAt: new Date().toISOString()
        };

        const sqsRes = await sqs.send(new SendMessageCommand({
            QueueUrl: HTR_QUEUE_URL,
            MessageBody: JSON.stringify(jobMessage)
        }));

        res.json({
            ok: true,
            status: 'queued',
            requestId,
            messageId: sqsRes.MessageId
        });

    } catch (err: any) {
        console.error('[HTR] Reprocess failed:', err);
        res.status(500).json({ error: 'Failed to enqueue HTR job' });
    }
});

export default router;
