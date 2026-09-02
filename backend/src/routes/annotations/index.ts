import { Router } from 'express';
import { firestore } from '../../lib/storage';
import fs from 'fs';
import path from 'path';
import { requireAuth } from '../../middleware/auth';
import admin from 'firebase-admin';
import { findFileDoc, getEffectiveRole } from '../../lib/firestore-helpers';

const router = Router({ mergeParams: true }); // Access parent :fileId

// Helper: Check local file existence
async function objectExists(key: string) {
    return fs.existsSync(key);
}

// Helper: Resolve file (owned or shared) and verify Edit access
async function resolveFileForEdit(uid: string, fileId: string) {
    // 1. Try finding as Owner
    let doc = await findFileDoc(uid, fileId);

    // 2. If not found, try finding via Shared Index
    if (!doc || !doc.exists) {
        const sharedRef = firestore.collection('userSharedIndex').doc(uid).collection('items').doc(fileId);
        const sharedSnap = await sharedRef.get();
        if (sharedSnap.exists) {
            const owner = sharedSnap.data()?.owner;
            if (owner) {
                // Look up in owner's scope
                doc = await findFileDoc(owner, fileId, undefined, owner);
            }
        }
    }

    if (!doc || !doc.exists) {
        return { error: { status: 404, msg: 'File not found' } };
    }

    // 3. Verify 'edit' permission
    const role = await getEffectiveRole(uid, doc);
    if (role !== 'edit') {
        return { error: { status: 403, msg: 'Write permission denied' } };
    }

    return { doc };
}

// POST /api/files/:fileId/annotations/save-request
router.post('/save-request', requireAuth, async (req, res) => {
    try {
        const { fileId } = req.params;
        const { payloadHash } = req.body;
        const uid = req.user!.uid;

        if (!payloadHash) return res.status(400).json({ error: 'Missing payloadHash' });

        const { doc, error } = await resolveFileForEdit(uid, fileId);
        if (error) return res.status(error.status).json({ error: error.msg });

        const data = doc!.data()!;

        // Conflict check / Skip check
        if (data.lastAnnotationsHash === payloadHash) {
            return res.json({ ok: true, skip: true, message: 'No changes detected' });
        }

        // Determine annotationsRef
        // It should be stored in the file doc (s3AnnotationsKey). If not, fallback or error.
        let annotationsRef = data?.s3AnnotationsKey || data?.annotationsRef;

        if (!annotationsRef) {
            // Should have been set by upload.
            // If legacy file, we might need to derive it or fail.
            // For now, fail or log.
            // Try to use s3Prefix if available?
            if (data?.s3Prefix) {
                annotationsRef = `${data.s3Prefix}/annotations-${fileId}.json`;
            } else {
                // If s3Prefix is missing, we might have a problem.
                // However, user might have just created the file without prefix if it was legacy.
                // Or maybe we can derive from path if folderId sent?
                // But generally, file doc should have updated struct.
                console.error(`File ${fileId} missing s3AnnotationsKey and s3Prefix`);
                return res.status(500).json({ error: 'Server configuration error: Missing annotations path' });
            }
        }

        // Use the local API endpoint
        const uploadUrl = `http://localhost:4000/api/files/${fileId}/annotations/upload`;

        res.json({ ok: true, uploadUrl, annotationsRef }); // Client needs uploadUrl. annotationsRef optional return.

    } catch (error) {
        console.error('Save request failed:', error);
        res.status(500).json({ error: 'Save request failed' });
    }
});

// POST /api/files/:fileId/annotations/confirm
router.post('/confirm', requireAuth, async (req, res) => {
    try {
        const { fileId } = req.params;
        const { payloadHash } = req.body;
        const uid = req.user!.uid;

        const { doc, error } = await resolveFileForEdit(uid, fileId);
        if (error) return res.status(error.status).json({ error: error.msg });

        const data = doc!.data()!;

        let annotationsRef = data?.s3AnnotationsKey || data?.annotationsRef;
        if (!annotationsRef && data?.s3Prefix) {
            annotationsRef = `${data.s3Prefix}/annotations-${fileId}.json`;
        }

        // Verify S3 existence
        const exists = await objectExists(annotationsRef);
        if (!exists) return res.status(400).json({ error: 'Upload verify failed' });

        // Update Firestore
        await doc.ref.update({
            lastAnnotationsHash: payloadHash,
            annotationsRef: annotationsRef, // Ensure legacy field is also set if needed
            lastSavedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ ok: true });
    } catch (error) {
        console.error('Confirm save failed:', error);
        res.status(500).json({ error: 'Confirm failed' });
    }
});

import express from 'express';

// PUT /api/files/:fileId/annotations/upload
router.put('/upload', requireAuth, express.json({ limit: '50mb' }), async (req, res) => {
    try {
        const { fileId } = req.params;
        const uid = req.user!.uid;

        const { doc, error } = await resolveFileForEdit(uid, fileId);
        if (error) return res.status(error.status).json({ error: error.msg });

        const data = doc!.data()!;
        let annotationsRef = data?.s3AnnotationsKey || data?.annotationsRef;

        if (!annotationsRef) {
            return res.status(500).json({ error: 'No annotations path configured' });
        }

        // Write the body to the file
        fs.writeFileSync(annotationsRef, JSON.stringify(req.body));
        res.json({ ok: true });
    } catch (error) {
        console.error('Upload annotations failed:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

export default router;
