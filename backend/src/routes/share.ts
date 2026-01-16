import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { firestore } from '../lib/storage';
import admin from 'firebase-admin';
import { logAudit } from '../lib/audit'; // Import Audit
import { revokeUserFileAccess } from '../lib/collab-server'; // Import Revocation
import {
    findFileDoc,
    findFolderDoc,
    addToSharedWithUser,
    addToSharedByUser,
    removeFromSharedWithUser,
    SharedItemMeta,
    RefType,
    revokeShare,
    trackLinkOpened
} from '../lib/firestore-helpers';

const router = Router();


router.get('/link/resolve', async (req, res) => {
    try {
        const { shareId, token } = req.query;
        if (!shareId || !token) return res.status(400).json({ error: 'Missing shareId or token' });

        // 1. Authenticate (Optional)
        // We act "optimistically". If token is present, try to verify user.
        let uid: string | null = null;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const idToken = authHeader.split('Bearer ')[1];
                const decoded = await admin.auth().verifyIdToken(idToken);
                uid = decoded.uid;
            } catch (e) {
                // Invalid token, treat as anonymous
            }
        }

        // 2. Load Link
        const linkRef = firestore.collection('shareLinks').doc(shareId as string);
        const linkSnap = await linkRef.get();
        if (!linkSnap.exists) return res.status(404).json({ error: 'Link not found' });

        const linkData = linkSnap.data()!;

        // 3. Validation
        if (linkData.disabled) return res.status(410).json({ error: 'Link revoked' });

        if (linkData.expiresAt) {
            const now = admin.firestore.Timestamp.now();
            if (linkData.expiresAt.toMillis() < now.toMillis()) {
                return res.status(410).json({ error: 'Link expired' });
            }
        }

        const { createHash } = await import('crypto');
        const hashedInput = createHash('sha256').update(token as string).digest('hex');
        if (hashedInput !== linkData.hashedToken) return res.status(403).json({ error: 'Invalid token' });

        // 4. Auth Requirement & Role Enforcement
        // Edit links require Authentication
        if ((linkData.requireAuth || linkData.role === 'edit') && !uid) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        // 5. Update Usage Stats
        await linkRef.update({
            usageCount: admin.firestore.FieldValue.increment(1),
            lastUsedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 6. Fetch Metadata
        let meta: any = null;
        let pdfUrl: string | null = null;
        let annotationsUrl: string | null = null;
        const ownerId = linkData.creator;

        if (linkData.scopeType === 'folder') {
            const doc = await findFolderDoc(ownerId, linkData.scopeId);
            if (doc && doc.exists) {
                meta = doc.data();
                meta.id = doc.id;
            }
        } else {
            // File
            const doc = await findFileDoc(ownerId, linkData.scopeId);
            if (doc && doc.exists) {
                const data = doc.data()!;
                meta = { ...data, id: doc.id };
                // Sanitize - don't expose S3 keys
                delete meta.s3PdfKey;
                delete meta.s3AnnotationsKey;

                // For View/Edit: Issue short-lived presigned URLs (5 mins)
                if (linkData.role === 'view' || linkData.role === 'edit') {
                    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
                    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
                    const { s3, S3_BUCKET } = await import('../lib/storage');

                    // PDF URL
                    if (data.s3PdfKey) {
                        const pdfCommand = new GetObjectCommand({ Bucket: S3_BUCKET, Key: data.s3PdfKey });
                        pdfUrl = await getSignedUrl(s3, pdfCommand, { expiresIn: 300 }); // 5 minutes
                    }

                    // Annotations URL - annotations travel with the PDF
                    if (data.s3AnnotationsKey) {
                        const annCommand = new GetObjectCommand({ Bucket: S3_BUCKET, Key: data.s3AnnotationsKey });
                        annotationsUrl = await getSignedUrl(s3, annCommand, { expiresIn: 300 });
                    }
                }
            }
        }

        if (!meta) return res.status(404).json({ error: 'Resource not found' });

        // 7. Project to "Shared With Me" (Authenticated Users Only)
        if (uid && uid !== linkData.creator) {
            await addToSharedWithUser(uid, linkData.scopeType, linkData.scopeId, linkData.role, {
                sharedVia: 'link',
                sharedBy: linkData.creator,
                shareId: linkData.id
            });

            // Track that this user opened this link (for revocation cleanup)
            await trackLinkOpened(shareId as string, uid);

            // Update Owner's "Shared by you" to list this user
            // We use viaMethod='link' so we know they got access via a link
            await addToSharedByUser(linkData.creator, linkData.scopeId, uid, linkData.scopeType, 'link');
        }

        // 8. Create Server-Side Share Session (for future edits/uploads/refresh)
        // For this step, we'll return a signed JWT as the "session ID"
        // This token allows access to /api/storage/sign for this scope
        // Payload: { sub: uid || 'anon', scopeId, role, shareId, exp: 10 mins }
        // Note: In a real "stored session" model, we'd write to Firestore, but JWT is standard stateless session.
        // We will skip the "shareSessionId" implementation for this immediate response 
        // and rely on `pdfUrl` for view and `addToSharedWithUser` (persistence) for edit.
        // The user can re-resolve the link to refresh.

        logAudit({
            actor: uid || 'anonymous',
            action: 'share_access',
            resourceId: linkData.scopeId,
            resourceType: linkData.scopeType,
            meta: { shareId, role: linkData.role, via: 'link' }
        });

        res.json({
            ok: true,
            meta,
            role: linkData.role,
            pdfUrl,
            annotationsUrl, // Annotations now travel with PDF
        });

    } catch (err) {
        console.error('Resolve link failed:', err);
        res.status(500).json({ error: 'Resolve link failed' });
    }
});

// POST /api/share/link/create
router.post('/link/create', requireAuth, async (req, res) => {
    try {
        const uid = req.user!.uid;
        const { scopeId, scopeType } = req.body;
        const role = req.body.role || 'view';
        // Defensive Default: Auth required by default unless explicitly disabled
        const requireAuthBool = req.body.requireAuth !== undefined ? req.body.requireAuth : true;

        let expiresAtDate: Date;
        if (req.body.expiresAt) {
            expiresAtDate = new Date(req.body.expiresAt);
        } else {
            // Default expiry: 7 days
            expiresAtDate = new Date();
            expiresAtDate.setDate(expiresAtDate.getDate() + 7);
        }

        if (!['file', 'folder'].includes(scopeType)) return res.status(400).json({ error: 'Invalid scope type' });
        if (!['view', 'edit'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

        // 1. Verify Ownership
        let docRef;
        if (scopeType === 'folder') {
            const doc = await findFolderDoc(uid, scopeId);
            if (!doc) return res.status(404).json({ error: 'Folder not found' });
            if (doc.data()?.ownerUid !== uid && doc.data()?.createdBy !== uid) return res.status(403).json({ error: 'Not owner' });
            docRef = doc.ref;
        } else {
            const doc = await findFileDoc(uid, scopeId);
            if (!doc) return res.status(404).json({ error: 'File not found' });
            if (doc.data()?.ownerUid !== uid && doc.data()?.createdBy !== uid) return res.status(403).json({ error: 'Not owner' });
            docRef = doc.ref;
        }

        // 2. Generate Token
        // Use Node crypto for secure token
        const { randomBytes, createHash } = await import('crypto');
        const rawToken = randomBytes(32).toString('hex');
        const hashedToken = createHash('sha256').update(rawToken).digest('hex');
        const shareId = admin.firestore().collection('shareLinks').doc().id;
        const now = admin.firestore.Timestamp.now();

        // 3. Transactional: Check existing links, auto-revoke if same role exists
        const revokedLinks: string[] = [];

        await firestore.runTransaction(async (tx) => {
            // Query existing active links for this scopeId and role
            const existingLinksQuery = firestore.collection('shareLinks')
                .where('scopeId', '==', scopeId)
                .where('role', '==', role)
                .where('disabled', '==', false);

            const existingSnap = await tx.get(existingLinksQuery);

            // Auto-revoke any existing links of the same role
            for (const existingDoc of existingSnap.docs) {
                console.log(`[LinkCreate] Auto-revoking existing ${role} link: ${existingDoc.id}`);
                tx.update(existingDoc.ref, {
                    disabled: true,
                    disabledAt: now,
                    disabledReason: 'superseded'
                });
                revokedLinks.push(existingDoc.id);
            }

            // Create the new link with scopeOwner field
            const linkDoc = {
                id: shareId,
                scopeType,
                scopeId,
                scopeOwner: uid, // Important: Store owner for resolution
                role,
                creator: uid,
                requireAuth: requireAuthBool,
                hashedToken,
                token: rawToken, // Store raw token so owner can copy it later
                disabled: false,
                usageCount: 0,
                createdAt: now,
                expiresAt: admin.firestore.Timestamp.fromDate(expiresAtDate)
            };

            tx.set(firestore.collection('shareLinks').doc(shareId), linkDoc);
        });

        // 4. Process revoked links (cleanup projections for affected users)
        for (const revokedShareId of revokedLinks) {
            try {
                // Use canonical revoke pipeline
                await revokeShare(revokedShareId, uid);
            } catch (e) {
                console.error(`[LinkCreate] Failed to process revocation for ${revokedShareId}:`, e);
            }
        }


        // 4. Update Resource Metadata (mark as shared)
        await docRef.set({ shared: true }, { merge: true });

        // 5. Update "Shared by you" projection
        await addToSharedByUser(uid, scopeId, 'link', scopeType);

        // 6. Return raw token (once)
        logAudit({
            actor: uid,
            action: 'share_create',
            resourceId: scopeId,
            resourceType: scopeType,
            meta: { shareId, role, updatedSharedStatus: true }
        });

        res.json({
            ok: true,
            shareId,
            token: rawToken,
            url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/s/${shareId}?t=${rawToken}`
        });

    } catch (err) {
        console.error('Create link failed:', err);
        res.status(500).json({ error: 'Create link failed' });
    }
});

// POST /api/share/link/revoke
router.post('/link/revoke', requireAuth, async (req, res) => {
    try {
        const uid = req.user!.uid;
        const { shareId } = req.body;

        const linkRef = firestore.collection('shareLinks').doc(shareId);
        const linkSnap = await linkRef.get();
        if (!linkSnap.exists) return res.status(404).json({ error: 'Link not found' });

        const data = linkSnap.data();
        if (data?.creator !== uid) return res.status(403).json({ error: 'Not owner of link' });

        // Use canonical revoke pipeline
        await revokeShare(shareId, uid);

        res.json({ ok: true });

    } catch (err) {
        console.error('Revoke link failed:', err);
        res.status(500).json({ error: 'Revoke link failed' });
    }
});

// POST /api/share/cleanup-projections
// Force cleanup stale projections for a file when all links have been revoked
// This is an admin/owner endpoint to fix stale data
router.post('/cleanup-projections', requireAuth, async (req, res) => {
    try {
        const uid = req.user!.uid;
        const { scopeId, scopeType } = req.body;

        if (!scopeId || !scopeType) {
            return res.status(400).json({ error: 'Missing scopeId or scopeType' });
        }

        // Verify ownership
        let docSnap;
        if (scopeType === 'folder') {
            docSnap = await findFolderDoc(uid, scopeId);
        } else {
            docSnap = await findFileDoc(uid, scopeId);
        }

        if (!docSnap || !docSnap.exists) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        const docData = docSnap.data();
        if (docData?.createdBy !== uid && docData?.ownerUid !== uid) {
            return res.status(403).json({ error: 'Only the owner can cleanup projections' });
        }

        // Check if there are any active links
        const activeLinksQuery = await firestore.collection('shareLinks')
            .where('scopeId', '==', scopeId)
            .where('disabled', '==', false)
            .get();

        if (!activeLinksQuery.empty) {
            return res.status(400).json({
                error: 'Cannot cleanup - there are still active links',
                activeLinks: activeLinksQuery.size
            });
        }

        // Find and remove all projections for this scopeId
        // Query all userSharedIndex items for this scopeId
        let removedCount = 0;

        // Get all users who might have projections by querying collectionGroup
        try {
            const projectionsQuery = await firestore.collectionGroup('items')
                .where('refId', '==', scopeId)
                .get();

            for (const doc of projectionsQuery.docs) {
                // Only delete if it's a share projection (not owner's own file)
                const data = doc.data();
                if (data.sharedVia === 'link' || data.sharedVia === 'direct') {
                    console.log(`[CleanupProjections] Removing projection at ${doc.ref.path}`);
                    await doc.ref.delete();
                    removedCount++;
                }
            }
        } catch (queryErr) {
            console.error('[CleanupProjections] CollectionGroup query failed:', queryErr);
        }

        // Also remove owner's "Shared by you" entry
        const ownerIndexRef = firestore.collection('userSharedIndex').doc(uid).collection('items').doc(scopeId);
        const ownerSnap = await ownerIndexRef.get();
        if (ownerSnap.exists) {
            await ownerIndexRef.delete();
            console.log('[CleanupProjections] Removed owner Shared-by-you entry');
        }

        // Mark file as not shared
        await docSnap.ref.update({ shared: false });

        logAudit({
            actor: uid,
            action: 'share_cleanup',
            resourceId: scopeId,
            resourceType: scopeType,
            meta: { removedProjections: removedCount }
        });

        res.json({
            ok: true,
            removedProjections: removedCount
        });

    } catch (err) {
        console.error('Cleanup projections failed:', err);
        res.status(500).json({ error: 'Cleanup failed' });
    }
});

// POST /api/share/remove-user-access
// Directly remove a specific user's projection (simple & reliable)
router.post('/remove-user-access', requireAuth, async (req, res) => {
    try {
        const uid = req.user!.uid;
        const { scopeId, scopeType, targetUid } = req.body;

        if (!scopeId || !scopeType || !targetUid) {
            return res.status(400).json({ error: 'Missing scopeId, scopeType, or targetUid' });
        }

        // Verify ownership
        let docSnap;
        if (scopeType === 'folder') {
            docSnap = await findFolderDoc(uid, scopeId);
        } else {
            docSnap = await findFileDoc(uid, scopeId);
        }

        if (!docSnap || !docSnap.exists) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        const docData = docSnap.data();
        if (docData?.createdBy !== uid && docData?.ownerUid !== uid) {
            return res.status(403).json({ error: 'Only the owner can remove user access' });
        }

        // Directly delete the user's projection
        const projectionRef = firestore.collection('userSharedIndex').doc(targetUid).collection('items').doc(scopeId);
        const projSnap = await projectionRef.get();

        if (projSnap.exists) {
            await projectionRef.delete();
            console.log(`[RemoveUserAccess] Removed projection for ${targetUid} on ${scopeId}`);

            logAudit({
                actor: uid,
                action: 'share_revoke',
                resourceId: scopeId,
                resourceType: scopeType,
                meta: { targetUid, method: 'direct_removal' }
            });

            res.json({ ok: true, removed: true });
        } else {
            res.json({ ok: true, removed: false, message: 'Projection not found' });
        }

    } catch (err) {
        console.error('Remove user access failed:', err);
        res.status(500).json({ error: 'Remove failed' });
    }
});

// GET /api/share/list-shared-users
// List all users who currently have a projection for a file (for debugging/admin)
router.get('/list-shared-users', requireAuth, async (req, res) => {
    try {
        const uid = req.user!.uid;
        const { scopeId, scopeType } = req.query;

        if (!scopeId || !scopeType) {
            return res.status(400).json({ error: 'Missing scopeId or scopeType' });
        }

        // Verify ownership
        let docSnap;
        if (scopeType === 'folder') {
            docSnap = await findFolderDoc(uid, scopeId as string);
        } else {
            docSnap = await findFileDoc(uid, scopeId as string);
        }

        if (!docSnap || !docSnap.exists) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        const docData = docSnap.data();
        if (docData?.createdBy !== uid && docData?.ownerUid !== uid) {
            return res.status(403).json({ error: 'Only the owner can list shared users' });
        }

        // Try to find shared users via collectionGroup query
        const sharedUsers: any[] = [];

        try {
            const projectionsQuery = await firestore.collectionGroup('items')
                .where('refId', '==', scopeId)
                .get();

            for (const doc of projectionsQuery.docs) {
                const data = doc.data();
                const pathParts = doc.ref.path.split('/');
                const userUid = pathParts[1]; // userSharedIndex/{uid}/items/{id}

                if (userUid !== uid) { // Exclude owner
                    sharedUsers.push({
                        uid: userUid,
                        role: data.role,
                        sharedVia: data.sharedVia,
                        sharedAt: data.createdAt
                    });
                }
            }
        } catch (queryErr) {
            console.error('[ListSharedUsers] CollectionGroup query failed:', queryErr);
            // Return empty list if query fails
        }

        res.json({ users: sharedUsers });

    } catch (err) {
        console.error('List shared users failed:', err);
        res.status(500).json({ error: 'List failed' });
    }
});

// GET /api/share/link/list
// List all share links for a given resource (owner only)
router.get('/link/list', requireAuth, async (req, res) => {
    try {
        const uid = req.user!.uid;
        const { scopeId, scopeType } = req.query;

        if (!scopeId || !scopeType) {
            return res.status(400).json({ error: 'Missing scopeId or scopeType' });
        }

        // Verify ownership first
        let docSnap;
        if (scopeType === 'folder') {
            docSnap = await findFolderDoc(uid, scopeId as string);
        } else {
            docSnap = await findFileDoc(uid, scopeId as string);
        }

        if (!docSnap || !docSnap.exists) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        const data = docSnap.data();
        if (data?.createdBy !== uid && data?.ownerUid !== uid) {
            return res.status(403).json({ error: 'Only the owner can view share links' });
        }

        // Query share links for this scope (using simple query to avoid index issues)
        // Filter by scopeId only, then filter and sort in JavaScript
        const linksSnap = await firestore.collection('shareLinks')
            .where('scopeId', '==', scopeId)
            .get();

        const links = linksSnap.docs
            .filter(doc => doc.data().creator === uid) // Filter by creator
            .map(doc => {
                const linkData = doc.data();
                const token = linkData.token; // Retrieve stored raw token
                return {
                    shareId: doc.id,
                    role: linkData.role,
                    disabled: linkData.disabled || false,
                    usageCount: linkData.usageCount || 0,
                    createdAt: linkData.createdAt?.toDate?.()?.toISOString() || null,
                    expiresAt: linkData.expiresAt?.toDate?.()?.toISOString() || null,
                    lastUsedAt: linkData.lastUsedAt?.toDate?.()?.toISOString() || null,
                    requireAuth: linkData.requireAuth || false,
                    token,
                    url: token ? `${process.env.FRONTEND_URL || 'http://localhost:5173'}/s/${doc.id}?t=${token}` : undefined
                };
            })
            .sort((a, b) => {
                // Sort by createdAt descending
                if (!a.createdAt) return 1;
                if (!b.createdAt) return -1;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });

        res.json({ links });

    } catch (err) {
        console.error('List links failed:', err);
        res.status(500).json({ error: 'Failed to list links' });
    }
});

// ============================================================================
// SHARED WITH ME (List)
// ============================================================================

// GET /api/share/with-me
router.get('/with-me', requireAuth, async (req, res) => {
    try {
        const uid = req.user!.uid;

        // 1. Query userSharedIndex
        const sharedIndexSnap = await firestore.collection('userSharedIndex')
            .doc(uid)
            .collection('items')
            .orderBy('createdAt', 'desc')
            .get();
        const items: any[] = [];
        const staleProjections: string[] = []; // Track stale projections for lazy cleanup

        // 2. Hydrate items from canonical source
        // We do this in parallel, but be mindful of limits.
        const promises = sharedIndexSnap.docs.map(async (doc) => {
            const data = doc.data();
            const { refId, refType, owner, shareId, sharedVia } = data;

            let canonicalDoc;
            try {
                if (refType === 'folder') {
                    canonicalDoc = await findFolderDoc(owner, refId);
                } else {
                    canonicalDoc = await findFileDoc(owner, refId);
                }
            } catch (e) {
                console.warn('Failed to find canonical doc', refId, e);
                staleProjections.push(refId);
                return null;
            }

            if (!canonicalDoc || !canonicalDoc.exists) {
                // File was deleted - mark for cleanup
                staleProjections.push(refId);
                return null;
            }

            // If shared via link, verify link is still active
            if (sharedVia === 'link' && shareId) {
                try {
                    const linkSnap = await firestore.collection('shareLinks').doc(shareId).get();
                    if (!linkSnap.exists) {
                        // Link is gone, this projection is stale
                        staleProjections.push(refId);
                        return null;
                    }

                    const linkData = linkSnap.data();
                    if (linkData?.disabled) {
                        // Link is disabled -> remove projection
                        staleProjections.push(refId);
                        return null;
                    }

                    // Check Expiry
                    if (linkData?.expiresAt) {
                        const now = admin.firestore.Timestamp.now();
                        if (linkData.expiresAt.toMillis() < now.toMillis()) {
                            staleProjections.push(refId);
                            return null;
                        }
                    }
                } catch (linkErr) {
                    console.warn('Failed to validate shareLink', shareId, linkErr);
                }
            }

            const canonicalData = canonicalDoc.data() || {};

            // Return combined object
            return {
                ...canonicalData, // Name, size, etc.
                id: refId, // Ensure ID is correct
                // Shared metadata overrides
                sharedRole: data.role,
                sharedBy: data.sharedBy,
                sharedVia: data.sharedVia,
                sharedAt: data.createdAt,
                ownerUid: owner, // Explicitly expose owner

                // If file, sanitize sensitive keys
                ...(refType === 'file' ? {
                    s3PdfKey: undefined,
                    s3AnnotationsKey: undefined,
                    annotationsRef: undefined
                } : {})
            };
        });

        const results = await Promise.all(promises);
        items.push(...results.filter(i => i !== null));

        // 3. Lazy cleanup of stale projections (fire and forget)
        if (staleProjections.length > 0) {
            console.log(`[SharedWithMe] Cleaning up ${staleProjections.length} stale projections for ${uid}`);
            for (const refId of staleProjections) {
                firestore.collection('userSharedIndex')
                    .doc(uid)
                    .collection('items')
                    .doc(refId)
                    .delete()
                    .catch(err => console.warn('Failed to cleanup stale projection', refId, err));
            }
        }

        res.json({ items });

    } catch (err) {
        console.error('[SharedWithMe] Failed:', err);
        res.status(500).json({ error: 'Failed to list shared items' });
    }
});

// GET /api/share/by-me
// Returns all items (files/folders) that the owner has shared via active links
router.get('/by-me', requireAuth, async (req, res) => {
    try {
        const uid = req.user!.uid;

        console.log(`[SharedByMe] Loading shared items for owner ${uid}`);

        // SIMPLE APPROACH: Query shareLinks directly for active links created by this user
        const activeLinksSnap = await firestore.collection('shareLinks')
            .where('creator', '==', uid)
            .where('disabled', '==', false)
            .get();

        console.log(`[SharedByMe] Found ${activeLinksSnap.docs.length} active links`);

        // Group by scopeId to avoid duplicates (same item shared with different roles)
        const itemsMap = new Map<string, { scopeId: string; scopeType: string; roles: string[]; linkCount: number }>();

        for (const linkDoc of activeLinksSnap.docs) {
            const linkData = linkDoc.data();
            const { scopeId, scopeType, role, expiresAt } = linkData;

            // Check expiry
            if (expiresAt) {
                const now = admin.firestore.Timestamp.now();
                if (expiresAt.toMillis() < now.toMillis()) {
                    continue; // Skip expired links
                }
            }

            if (itemsMap.has(scopeId)) {
                const existing = itemsMap.get(scopeId)!;
                if (!existing.roles.includes(role)) {
                    existing.roles.push(role);
                }
                existing.linkCount++;
            } else {
                itemsMap.set(scopeId, {
                    scopeId,
                    scopeType: scopeType || 'file',
                    roles: [role],
                    linkCount: 1
                });
            }
        }

        console.log(`[SharedByMe] ${itemsMap.size} unique items with active links`);

        // Hydrate each unique item
        const items: any[] = [];

        for (const [scopeId, info] of itemsMap) {
            let canonicalDoc;

            if (info.scopeType === 'folder') {
                canonicalDoc = await findFolderDoc(uid, scopeId);
            } else {
                canonicalDoc = await findFileDoc(uid, scopeId);
            }

            if (!canonicalDoc || !canonicalDoc.exists) {
                console.log(`[SharedByMe] Could not find canonical doc for ${scopeId} (type: ${info.scopeType})`);
                continue;
            }

            const canonicalData = canonicalDoc.data() || {};

            items.push({
                id: scopeId,
                name: canonicalData.name || 'Untitled',
                type: info.scopeType,
                roles: info.roles,
                linkCount: info.linkCount,
                via: ['link'],
                ownerUid: uid,
                createdAt: canonicalData.createdAt,
                updatedAt: canonicalData.updatedAt
            });
        }

        // Also include items shared directly with users (from userSharedIndex)
        try {
            const sharedIndexSnap = await firestore.collection('userSharedIndex')
                .doc(uid)
                .collection('items')
                .get();

            for (const doc of sharedIndexSnap.docs) {
                const data = doc.data();
                // Only add if via includes 'direct' and not already in items
                if (data.via?.includes('direct') && !itemsMap.has(data.refId)) {
                    const refType = data.refType || 'file';
                    let canonicalDoc;

                    if (refType === 'folder') {
                        canonicalDoc = await findFolderDoc(uid, data.refId);
                    } else {
                        canonicalDoc = await findFileDoc(uid, data.refId);
                    }

                    if (canonicalDoc && canonicalDoc.exists) {
                        const canonicalData = canonicalDoc.data() || {};
                        items.push({
                            id: data.refId,
                            name: canonicalData.name || 'Untitled',
                            type: refType,
                            sharedWith: data.sharedWith || [],
                            via: ['direct'],
                            ownerUid: uid,
                            createdAt: canonicalData.createdAt,
                            updatedAt: canonicalData.updatedAt
                        });
                    }
                }
            }
        } catch (indexErr) {
            console.warn('[SharedByMe] Failed to read userSharedIndex:', indexErr);
        }

        console.log(`[SharedByMe] Returning ${items.length} total items`);
        res.json({ items });

    } catch (err) {
        console.error('[SharedByMe] Failed:', err);
        res.status(500).json({ error: 'Failed to list shared items' });
    }
});


// ============================================================================
// SHARE TO USER (Grant)
// ============================================================================

interface ShareUserRequest {
    scopeType: 'file' | 'folder';
    scopeId: string;
    targetUid: string;
    role: 'view' | 'edit';
}

// POST /api/share/user
router.post('/user', requireAuth, async (req, res) => {
    const { scopeType, scopeId, targetUid, role } = req.body as ShareUserRequest;
    const uid = req.user!.uid;

    if (!['file', 'folder'].includes(scopeType) || !scopeId || !targetUid || !['view', 'edit'].includes(role)) {
        return res.status(400).json({ error: 'Invalid arguments' });
    }

    try {
        // 1. Find the resource and verify ownership
        // We only support sharing *your own* files for now.
        let docRef;
        let docSnap;

        if (scopeType === 'folder') {
            docSnap = await findFolderDoc(uid, scopeId);
        } else {
            docSnap = await findFileDoc(uid, scopeId);
        }

        if (!docSnap || !docSnap.exists) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        const data = docSnap.data();
        if (data?.createdBy !== uid && data?.ownerUid !== uid) {
            return res.status(403).json({ error: 'Only the owner can share' });
        }

        docRef = docSnap.ref;

        // 2. Upsert ACL entry
        // /files/{id}/acl/{targetUid}
        const aclRef = docRef.collection('acl').doc(targetUid);
        await aclRef.set({
            subjectType: 'user',
            subjectId: targetUid,
            role: role,
            grantedBy: uid,
            grantedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 3. Mark resource as shared
        await docRef.update({
            shared: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 4. Create Projection: Shared WITH user
        await addToSharedWithUser(targetUid, scopeType, scopeId, role, {
            sharedVia: 'direct',
            sharedBy: uid // Owner
        });

        // 5. Create Projection: Shared BY owner
        await addToSharedByUser(uid, scopeId, targetUid, scopeType);

        console.log(`[Share] User ${uid} shared ${scopeType} ${scopeId} with ${targetUid} as ${role}`);

        // Audit log
        logAudit({
            actor: uid,
            action: 'share_create',
            resourceId: scopeId,
            resourceType: scopeType,
            meta: { targetUid, role, via: 'direct' }
        });

        res.json({ ok: true });

    } catch (err) {
        console.error('[ShareUser] Failed:', err);
        res.status(500).json({ error: 'Failed to share' });
    }
});

// PATCH /api/share/user - Update a user's role
router.patch('/user', requireAuth, async (req, res) => {
    const { scopeType, scopeId, targetUid, role } = req.body as ShareUserRequest;
    const uid = req.user!.uid;

    if (!['file', 'folder'].includes(scopeType) || !scopeId || !targetUid || !['view', 'edit'].includes(role)) {
        return res.status(400).json({ error: 'Invalid arguments' });
    }

    try {
        // 1. Find the resource and verify ownership
        let docSnap;
        if (scopeType === 'folder') {
            docSnap = await findFolderDoc(uid, scopeId);
        } else {
            docSnap = await findFileDoc(uid, scopeId);
        }

        if (!docSnap || !docSnap.exists) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        const data = docSnap.data();
        if (data?.createdBy !== uid && data?.ownerUid !== uid) {
            return res.status(403).json({ error: 'Only the owner can update roles' });
        }

        const docRef = docSnap.ref;

        // 2. Check if ACL entry exists
        const aclRef = docRef.collection('acl').doc(targetUid);
        const aclSnap = await aclRef.get();
        if (!aclSnap.exists) {
            return res.status(404).json({ error: 'User does not have access to this resource' });
        }

        // 3. Update the role
        await aclRef.update({
            role: role,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 4. Update the shared projection for targetUid
        const sharedIndexRef = firestore.collection('userSharedIndex').doc(targetUid).collection('items').doc(scopeId);
        await sharedIndexRef.update({
            role: role,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[Share] User ${uid} updated ${targetUid}'s role to ${role} on ${scopeType} ${scopeId}`);

        logAudit({
            actor: uid,
            action: 'share_update',
            resourceId: scopeId,
            resourceType: scopeType,
            meta: { targetUid, newRole: role }
        });

        res.json({ ok: true });

    } catch (err) {
        console.error('[ShareUpdate] Failed:', err);
        res.status(500).json({ error: 'Failed to update role' });
    }
});

// ============================================================================
// REVOKE ACCESS
// ============================================================================

interface RevokeRequest {
    scopeType: 'file' | 'folder';
    scopeId: string;
    targetUid: string;
}

// POST /api/share/revoke
router.post('/revoke', requireAuth, async (req, res) => {
    const { scopeType, scopeId, targetUid } = req.body as RevokeRequest;
    const uid = req.user!.uid;

    try {
        // 1. Verify Ownership
        let docRef;
        let docSnap;

        if (scopeType === 'folder') {
            docSnap = await findFolderDoc(uid, scopeId);
        } else {
            docSnap = await findFileDoc(uid, scopeId);
        }

        if (!docSnap || !docSnap.exists) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        const data = docSnap.data();
        if (data?.createdBy !== uid && data?.ownerUid !== uid) {
            return res.status(403).json({ error: 'Only the owner can revoke' });
        }

        docRef = docSnap.ref;

        // 2. Delete ACL
        await docRef.collection('acl').doc(targetUid).delete();

        // 3. Remove Projection: Shared WITH user
        await removeFromSharedWithUser(targetUid, scopeId);

        // 4. Update Owner Projection
        const ownerShareRef = firestore.collection('userSharedIndex').doc(uid).collection('items').doc(scopeId);
        await ownerShareRef.update({
            sharedWith: admin.firestore.FieldValue.arrayRemove(targetUid)
        });

        // 5. Check if still shared
        // We fetch the owner share ref again to see if array is empty
        const ownerShareSnap = await ownerShareRef.get();
        const shareData = ownerShareSnap.data();
        if (shareData && (!shareData.sharedWith || shareData.sharedWith.length === 0) && (!shareData.via || !shareData.via.includes('link'))) {
            // No more shares? 
            // Strictly, if sharedWith is empty AND via does not include 'link'.
            // Simplification: if 'sharedWith' is empty, we might assume shared=false if no link sharing enabled.
            // We'll leave the owner projection but mark shared=false on the file? 
            // Spec says: "If no remaining shares: Set shared = false"

            // Check if link sharing is active? (Not implemented yet, so assume no if via doesn't say link)
            // But 'via' is an array.
            // If sharedWith is empty, we can mostly assume.

            await docRef.update({ shared: false });

            // Optionally remove owner's "Shared by you" entry completely?
            // "Optionally remove owner’s 'Shared by you' entry" -> Yes, clean it up.
            await ownerShareRef.delete();
        }

        console.log(`AUDIT: acl_revoke actor=${uid} target=${targetUid} scope=${scopeId}`);

        logAudit({
            actor: uid,
            action: 'share_revoke',
            resourceId: scopeId,
            resourceType: scopeType,
            meta: { targetUid, via: 'direct' }
        });

        // 6. Kill active collab sessions
        try {
            const killed = revokeUserFileAccess(scopeId, targetUid);
            if (killed > 0) console.log(`[Revoke] Terminated ${killed} active sessions.`);
        } catch (e) {
            console.error('Failed to kill sessions', e);
        }

        res.json({ ok: true });

    } catch (err) {
        console.error('[Revoke] Failed:', err);
        res.status(500).json({ error: 'Failed to revoke' });
    }
});

// ============================================================================
// INSPECT PERMISSIONS (Owner Only)
// ============================================================================

// GET /api/share/permissions?scopeId=...&scopeType=...
router.get('/permissions', requireAuth, async (req, res) => {
    try {
        const uid = req.user!.uid;
        const scopeId = req.query.scopeId as string;
        const scopeType = req.query.scopeType as string;

        if (!scopeId || !['file', 'folder'].includes(scopeType)) {
            return res.status(400).json({ error: 'Invalid arguments' });
        }

        // 1. Verify Ownership
        let docSnap;
        if (scopeType === 'folder') {
            docSnap = await findFolderDoc(uid, scopeId);
        } else {
            docSnap = await findFileDoc(uid, scopeId);
        }

        if (!docSnap || !docSnap.exists) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        const data = docSnap.data();
        if (data?.createdBy !== uid && data?.ownerUid !== uid) {
            return res.status(403).json({ error: 'Only the owner can view permissions' });
        }

        // 2. Fetch ACLs
        const aclSnap = await docSnap.ref.collection('acl').get();
        const permissions: any[] = [];

        for (const doc of aclSnap.docs) {
            const acl = doc.data();
            // Enrich with user email via Auth
            let email = 'Unknown';
            let displayName = '';
            try {
                const userRecord = await admin.auth().getUser(acl.subjectId);
                email = userRecord.email || 'No Email';
                displayName = userRecord.displayName || '';
            } catch (e) {
                console.warn(`Failed to resolve user ${acl.subjectId}`, e);
            }

            permissions.push({
                uid: acl.subjectId,
                role: acl.role,
                grantedAt: acl.grantedAt,
                email,
                displayName
            });
        }

        res.json({ permissions });

    } catch (err) {
        console.error('[Permissions] Failed:', err);
        res.status(500).json({ error: 'Failed to list permissions' });
    }
});

// GET /api/share/link/children
// List contents of a shared folder (Anonymous friendly)
router.get('/link/children', async (req, res) => {
    try {
        const { shareId, token } = req.query;
        if (!shareId || !token) return res.status(400).json({ error: 'Missing shareId or token' });

        // 1. Validate Link
        const linkRef = firestore.collection('shareLinks').doc(shareId as string);
        const linkSnap = await linkRef.get();
        if (!linkSnap.exists) return res.status(404).json({ error: 'Link not found' });
        const linkData = linkSnap.data()!;

        if (linkData.disabled) return res.status(410).json({ error: 'Link revoked' });
        if (linkData.expiresAt && linkData.expiresAt.toMillis() < Date.now()) return res.status(410).json({ error: 'Link expired' });

        const { createHash } = await import('crypto');
        const hashedInput = createHash('sha256').update(token as string).digest('hex');
        if (hashedInput !== linkData.hashedToken) return res.status(403).json({ error: 'Invalid token' });

        if (linkData.scopeType !== 'folder') return res.status(400).json({ error: 'Link is not for a folder' });

        // 2. Fetch Children
        // We only return direct children of the shared folder for now
        const ownerId = linkData.creator;
        const folderId = linkData.scopeId;

        // Find the folder doc to access its subcollection
        const folderDoc = await findFolderDoc(ownerId, folderId);
        if (!folderDoc || !folderDoc.exists) {
            return res.status(404).json({ error: 'Shared folder not found or deleted' });
        }

        // Query the 'children' subcollection
        // Note: New items have 'trash: false', old items might not.
        // We must check if 'children' has mixed types.
        // Yes, files.ts puts both files and folders into 'children'.
        const childrenSnap = await folderDoc.ref.collection('children')
            // .where('trash', '==', false) // Disabled for legacy
            .orderBy('updatedAt', 'desc')
            .get();

        const items = childrenSnap.docs.map(d => {
            const data = d.data();
            return {
                ...data,
                id: d.id,
                // Ensure kind/type is set (files.ts sets 'type': 'file' or 'folder')
                kind: data.type || (data.mimeType ? 'file' : 'folder'),
                s3PdfKey: undefined, // Sanitize
                s3AnnotationsKey: undefined
            };
        });

        res.json({ items });

    } catch (err) {
        console.error('List link children failed:', err);
        res.status(500).json({ error: 'Failed to list children' });
    }
});

// GET /api/share/link/access-file
// Get content (URL) of a file inside a shared folder
router.get('/link/access-file', async (req, res) => {
    try {
        const { shareId, token, fileId } = req.query;
        if (!shareId || !token || !fileId) return res.status(400).json({ error: 'Missing args' });

        // 1. Validate Link
        const linkRef = firestore.collection('shareLinks').doc(shareId as string);
        const linkSnap = await linkRef.get();
        if (!linkSnap.exists) return res.status(404).json({ error: 'Link not found' });
        const linkData = linkSnap.data()!;

        if (linkData.disabled) return res.status(410).json({ error: 'Link revoked' });
        if (linkData.expiresAt && linkData.expiresAt.toMillis() < Date.now()) return res.status(410).json({ error: 'Link expired' });

        const { createHash } = await import('crypto');
        const hashedInput = createHash('sha256').update(token as string).digest('hex');
        if (hashedInput !== linkData.hashedToken) return res.status(403).json({ error: 'Invalid token' });

        if (linkData.scopeType !== 'folder') return res.status(400).json({ error: 'Link must be folder type for nested access' });

        // 2. Verify Inclusion (Walk Up)
        const ownerId = linkData.creator;
        let currentId = fileId as string;
        let isIncluded = false;
        let depth = 0;
        let fileData: any = null;

        // Get initial file
        const fileDoc = await findFileDoc(ownerId, currentId);
        if (!fileDoc || !fileDoc.exists) return res.status(404).json({ error: 'File not found' });
        fileData = fileDoc.data();
        currentId = fileData.parentId;

        if (fileData.ownerUid !== ownerId && fileData.createdBy !== ownerId) return res.status(404).json({ error: 'File not found' }); // Owner mismatch

        // Walk up parents
        while (currentId && currentId !== 'root' && depth < 20) {
            if (currentId === linkData.scopeId) {
                isIncluded = true;
                break;
            }
            const parentDoc = await findFolderDoc(ownerId, currentId);
            if (!parentDoc || !parentDoc.exists) break;
            const parentData = parentDoc.data();
            currentId = parentData?.parentId;
            depth++;
        }

        if (!isIncluded) {
            // Maybe the file ITSELF was the target? But scope is folder. 
            // Logic above checks parents.
            return res.status(403).json({ error: 'File is not in the shared folder' });
        }

        // 3. Generate URLs
        let pdfUrl: string | null = null;
        let annotationsUrl: string | null = null;

        if (linkData.role === 'view' || linkData.role === 'edit') {
            const { GetObjectCommand } = await import('@aws-sdk/client-s3');
            const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
            const { s3, S3_BUCKET } = await import('../lib/storage');

            // PDF URL
            if (fileData.s3PdfKey) {
                const pdfCommand = new GetObjectCommand({ Bucket: S3_BUCKET, Key: fileData.s3PdfKey });
                pdfUrl = await getSignedUrl(s3, pdfCommand, { expiresIn: 300 }); // 5 min
            }

            // Annotations URL
            if (fileData.s3AnnotationsKey) {
                const annCommand = new GetObjectCommand({ Bucket: S3_BUCKET, Key: fileData.s3AnnotationsKey });
                annotationsUrl = await getSignedUrl(s3, annCommand, { expiresIn: 300 });
            }
        }

        logAudit({
            actor: 'anonymous',
            action: 'view',
            resourceId: fileDoc.id,
            resourceType: 'file',
            meta: { shareId, scopeId: linkData.scopeId }
        });

        res.json({
            ok: true,
            meta: {
                ...fileData,
                id: fileDoc.id,
                s3PdfKey: undefined,
                s3AnnotationsKey: undefined
            },
            role: linkData.role,
            pdfUrl,
            annotationsUrl
        });

    } catch (err) {
        console.error('Access nested file failed:', err);
        res.status(500).json({ error: 'Access failed' });
    }
});

// GET /api/share/link/zip
// Download folder as zip
router.get('/link/zip', async (req, res) => {
    try {
        const { shareId, token, subFolderId } = req.query;
        if (!shareId || !token) return res.status(400).json({ error: 'Missing args' });

        // 1. Validate Link
        const linkRef = firestore.collection('shareLinks').doc(shareId as string);
        const linkSnap = await linkRef.get();
        if (!linkSnap.exists) return res.status(404).json({ error: 'Link not found' });
        const linkData = linkSnap.data()!;

        if (linkData.disabled) return res.status(410).json({ error: 'Link revoked' });
        if (linkData.expiresAt && linkData.expiresAt.toMillis() < Date.now()) return res.status(410).json({ error: 'Link expired' });

        const { createHash } = await import('crypto');
        const hashedInput = createHash('sha256').update(token as string).digest('hex');
        if (hashedInput !== linkData.hashedToken) return res.status(403).json({ error: 'Invalid token' });

        if (linkData.scopeType !== 'folder') return res.status(400).json({ error: 'Link must be folder type' });

        // 2. Determine Target Folder & Validate
        const ownerId = linkData.creator;
        let targetFolderId = (subFolderId as string) || linkData.scopeId;

        let folderName = 'download';

        // If subFolderId specified, verify it is inside the share scope
        if (targetFolderId !== linkData.scopeId) {
            let currentId = targetFolderId;
            let isIncluded = false;
            let depth = 0;
            // Walk up
            while (currentId && currentId !== 'root' && depth < 20) {
                if (currentId === linkData.scopeId) {
                    isIncluded = true;
                    break;
                }
                const parentDoc = await findFolderDoc(ownerId, currentId);
                if (!parentDoc || !parentDoc.exists) break;
                currentId = parentDoc.data()?.parentId;
                depth++;
            }
            if (!isIncluded) return res.status(403).json({ error: 'Folder not in shared scope' });
        }

        // Get Metadata for Filename
        const targetDoc = await findFolderDoc(ownerId, targetFolderId);
        if (!targetDoc || !targetDoc.exists) return res.status(404).json({ error: 'Folder not found' });
        folderName = targetDoc.data()?.name || 'folder';

        // 3. Setup Archiver
        const archiver = (await import('archiver')).default;
        const archive = archiver('zip', { zlib: { level: 9 } });

        res.attachment(`${folderName}.zip`);
        res.setHeader('Content-Type', 'application/zip');

        logAudit({
            actor: 'anonymous',
            action: 'zip_download',
            resourceId: targetFolderId,
            resourceType: 'folder',
            meta: { shareId, subFolderId }
        });

        archive.pipe(res);

        // 4. Recursive Fetch & Stream
        const { s3, S3_BUCKET } = await import('../lib/storage'); // Reuse existing s3 client
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');

        // Helper for recursion
        // We traverse document references to avoid re-querying `findFolderDoc` constantly
        const processFolder = async (folderRef: any, basePath: string) => {
            const childrenSnap = await folderRef.collection('children').get();

            for (const doc of childrenSnap.docs) {
                const data = doc.data();
                const type = data.type || (data.mimeType ? 'file' : 'folder');

                if (type === 'file' && data.s3PdfKey && !data.trash) {
                    const filePath = basePath + (data.name || 'file') + '.pdf'; // normalized extension

                    try {
                        const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: data.s3PdfKey });
                        // We need a readable stream from S3. 
                        // AWS SDK v3 returns a generic Body (ReadableStream | Readable | Blob ...).
                        // archiver accepts Readable.
                        const s3Item = await s3.send(command);
                        if (s3Item.Body) {
                            archive.append(s3Item.Body as any, { name: filePath });
                        }
                    } catch (e) {
                        console.error(`Failed to zip file ${data.id}:`, e);
                        // Continue ensuring zip doesn't fail entire request?
                        // Archiver might handle errors via 'error' event, but we catch generic JS errors here.
                    }
                } else if (type === 'folder' && !data.trash) {
                    await processFolder(doc.ref, basePath + (data.name || 'folder') + '/');
                }
            }
        };

        // Handle Archiver Errors
        archive.on('error', (err: any) => {
            console.error('Archiver error:', err);
            if (!res.headersSent) res.status(500).json({ error: 'Zip failed' });
        });

        // Start processing
        await processFolder(targetDoc.ref, ''); // Root of zip is empty string path
        await archive.finalize();

    } catch (err) {
        console.error('Zip download failed:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Download failed' });
    }
});

export default router;
