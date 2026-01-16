/**
 * Embedding Ingest Router
 * 
 * Handles Embedding-related job triggering.
 * - POST /reprocess: Manually enqueue a page for Embed (Chunking -> Embedding)
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../../middleware/auth';
import { sqs, s3, S3_BUCKET } from '../../lib/storage';
import { SendMessageCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { findFileDocByOwnerAndId } from '../../lib/firestore-helpers';

const router = Router();
const EMBED_PAGE_QUEUE_NAME = process.env.EMBED_PAGE_QUEUE_NAME || 'embedding-page-ingest';
let EMBED_PAGE_QUEUE_URL = process.env.EMBED_PAGE_QUEUE_URL || '';

/**
 * Embed Page Job Message
 */
interface EmbedPageJobMessage {
    jobType: 'EMBED_PAGE';
    requestId: string;
    userId: string;
    docId: string;
    page: number;
    sidecarKey: string;
    trigger: string;
    requestedAt: string;
    force: boolean;
}

/**
 * POST /api/ingest/embed/reprocess
 * 
 * Manually trigger Embedding for a page.
 * Body: { docId, page }
 */
router.post('/reprocess', requireAuth, async (req, res) => {
    const requestId = uuidv4();
    try {
        const uid = req.user!.uid;
        const { docId, page } = req.body;

        if (!docId || page === undefined) {
            return res.status(400).json({ error: 'Missing docId or page' });
        }

        const pageNum = parseInt(page, 10);
        const prefix = `users/${uid}/docs/${docId}`;
        const sidecarKey = `${prefix}/ocr/page-${String(pageNum).padStart(4, '0')}.json`;

        // 1. Verify Sidecar Exists
        try {
            await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: sidecarKey }));
        } catch (e: any) {
            return res.status(400).json({ error: 'OCR sidecar not found.' });
        }

        // 2. Get Queue URL
        if (!EMBED_PAGE_QUEUE_URL) {
            try {
                const qRes = await sqs.send(new GetQueueUrlCommand({ QueueName: EMBED_PAGE_QUEUE_NAME }));
                if (qRes.QueueUrl) EMBED_PAGE_QUEUE_URL = qRes.QueueUrl;
            } catch (e) {
                return res.status(503).json({ error: 'Embed Queue unavailable' });
            }
        }

        // 3. Enqueue
        const jobMessage: EmbedPageJobMessage = {
            jobType: 'EMBED_PAGE',
            requestId,
            userId: uid,
            docId,
            page: pageNum,
            sidecarKey,
            trigger: 'manual',
            requestedAt: new Date().toISOString(),
            force: true
        };

        const sqsRes = await sqs.send(new SendMessageCommand({
            QueueUrl: EMBED_PAGE_QUEUE_URL,
            MessageBody: JSON.stringify(jobMessage)
        }));

        res.json({
            ok: true,
            status: 'queued',
            requestId,
            messageId: sqsRes.MessageId
        });

    } catch (err: any) {
        console.error('[Embed] Reprocess failed:', err);
        res.status(500).json({ error: 'Failed to enqueue Embed job' });
    }
});

export default router;
