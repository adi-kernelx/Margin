
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { firestore } from '../lib/storage';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * POST /api/local-files/register
 * Register a local file by identity (hash).
 * Returns existing localId if found, or new one.
 */
router.post('/register', requireAuth, async (req, res) => {
    try {
        const uid = req.user!.uid;
        const { displayName, pdfHash, pageCount, fileSize } = req.body;

        if (!displayName || !pdfHash) {
            return res.status(400).json({ error: 'Missing required fields: displayName, pdfHash' });
        }

        // 1. Check for existing file with same hash for this user
        const localFilesRef = firestore.collection('users').doc(uid).collection('localFiles');
        const q = localFilesRef.where('pdfHash', '==', pdfHash).limit(1);
        const snapshot = await q.get();

        if (!snapshot.empty) {
            // Found existing
            const doc = snapshot.docs[0];
            const data = doc.data();

            // Update lastOpenedAt
            await doc.ref.update({
                lastOpenedAt: new Date().toISOString()
            });

            return res.json({
                localId: doc.id,
                isNew: false,
                file: data
            });
        }

        // 2. Register New
        const newLocalId = uuidv4();
        const now = new Date().toISOString();

        const newDoc = {
            localId: newLocalId,
            ownerId: uid,
            displayName,
            pdfHash,
            pageCount: pageCount || 0,
            fileSize: fileSize || 0,
            createdAt: now,
            lastOpenedAt: now,
            ocr: {
                version: null,
                status: 'not_started'
            }
        };

        await localFilesRef.doc(newLocalId).set(newDoc);

        return res.json({
            localId: newLocalId,
            isNew: true,
            file: newDoc
        });

    } catch (err: any) {
        console.error('[LocalFiles] Registration failed:', err);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});

export default router;
