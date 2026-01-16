import * as Y from 'yjs';
import { s3 } from './storage';
import { logAudit } from './audit';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const BUCKET = process.env.S3_BUCKET;

// Interface expected by y-websocket utils.setPersistence
export const persistence = {
    bindState: async (docName: string, doc: Y.Doc) => {
        const fileId = docName;

        // 1. Load Initial State from S3
        // We look for `collab-snapshots/${fileId}.bin`
        // We might keep incremental updates too, but for simplicity: Always full snapshot.
        try {
            const key = `collab-snapshots/${fileId}.bin`;
            const command = new GetObjectCommand({
                Bucket: BUCKET,
                Key: key
            });

            const response = await s3.send(command).catch((e: any) => {
                if (e.name === 'NoSuchKey' || e.Code === 'NoSuchKey' || e['$metadata']?.httpStatusCode === 404) return null;
                throw e;
            });

            if (response && response.Body) {
                // Read stream to buffer
                const byteArray = await response.Body.transformToByteArray();
                // Apply update V1 or V2?
                // Yjs usually stores defaults as update.
                // Apply update
                Y.applyUpdate(doc, byteArray);
                console.log(`[Persistence] Loaded snapshot for ${fileId}, size: ${byteArray.length}`);
            }
        } catch (err: any) {
            console.error(`[Persistence] Failed to load snapshot for ${fileId}:`, err.message);
        }

        // 2. Listen for Updates and Persist
        // Debounce logic: Wait until updates stop for X seconds, or max Y seconds.
        let timeout: NodeJS.Timeout | null = null;
        let lastSave = Date.now();
        const DEBOUNCE_MS = 5000; // 5 seconds of silence
        const MAX_WAIT_MS = 30000; // 30 seconds max wait

        const saveSnapshot = async () => {
            if (timeout) clearTimeout(timeout);
            timeout = null;

            try {
                const state = Y.encodeStateAsUpdate(doc); // Encode as single update (Snapshot)
                const key = `collab-snapshots/${fileId}.bin`;

                await s3.send(new PutObjectCommand({
                    Bucket: BUCKET,
                    Key: key,
                    Body: state,
                    ContentType: 'application/octet-stream'
                }));

                lastSave = Date.now();
                console.log(`[Persistence] Saved snapshot for ${fileId}, size: ${state.length}`);

                // Audit
                logAudit({
                    actor: 'system',
                    action: 'yjs_snapshot',
                    resourceId: fileId,
                    resourceType: 'file',
                    meta: { size: state.length }
                });

            } catch (err: any) {
                console.error(`[Persistence] Save failed for ${fileId}:`, err.message);
            }
        };

        doc.on('update', (update, origin) => {
            // Schedule save
            const now = Date.now();

            if (timeout) clearTimeout(timeout);

            if (now - lastSave > MAX_WAIT_MS) {
                saveSnapshot();
            } else {
                timeout = setTimeout(saveSnapshot, DEBOUNCE_MS);
            }
        });
    },

    writeState: async (docName: string, doc: Y.Doc) => {
        // y-websocket might call this on destruction if configured?
        // But bindState handles the live update saving.
        // We can force save here.
        // For our S3 adapter, bindState handled everything.
        return Promise.resolve();
    }
};
