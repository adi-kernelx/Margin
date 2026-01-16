import { Router } from 'express';
import { requireAuth, requireAuthOptional } from '../middleware/auth';
import { firestore } from '../lib/storage';
import admin from 'firebase-admin';
import { findFileDoc, findFileDocByOwnerAndId, findFolderDoc, getEffectiveRole } from '../lib/firestore-helpers';
import jwt from 'jsonwebtoken';
import { logAudit } from '../lib/audit';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-prod';
const TOKEN_EXPIRY = '10m'; // 10 minutes session

// POST /api/collab/join
// Handshake endpoint to get a room token
router.post('/join', requireAuthOptional, async (req, res) => {
    try {
        const { fileId, shareId, linkToken, parentFolderId } = req.body;
        const uid = req.user?.uid || null;

        if (!fileId) return res.status(400).json({ error: 'Missing fileId' });

        let role: 'view' | 'edit' | null = null;
        let actorId = uid || 'anonymous';
        let verifiedViaStr = 'direct';
        let fileDoc: admin.firestore.DocumentSnapshot | null = null;

        // ----------------------------------------------------------------
        // 1. LINK ACCESS STRATEGY (Prioritize if shareId provided)
        // ----------------------------------------------------------------
        if (shareId && linkToken) {
            console.log(`[CollabJoin] Trying LINK strategy: shareId=${shareId}`);
            const linkRef = firestore.collection('shareLinks').doc(shareId);
            const linkSnap = await linkRef.get();

            if (linkSnap.exists) {
                const linkData = linkSnap.data()!;
                if (!linkData.disabled && (!linkData.expiresAt || linkData.expiresAt.toMillis() > Date.now())) {
                    const { createHash } = await import('crypto');
                    const hashedInput = createHash('sha256').update(linkToken).digest('hex');
                    if (hashedInput === linkData.hashedToken) {
                        // Link Valid - Use Creator as Context Owner
                        const ownerUid = linkData.creator;
                        console.log(`[CollabJoin] Link valid, ownerUid=${ownerUid}`);

                        // Attempt to find file in Owner's scope
                        // Use parentFolderId if available to optimize nested lookup
                        fileDoc = await findFileDoc(ownerUid, fileId, parentFolderId, ownerUid);

                        if (fileDoc && fileDoc.exists) {
                            console.log(`[CollabJoin] Found file via LINK strategy`);
                            if (linkData.role === 'edit') role = 'edit';
                            else role = 'view';

                            verifiedViaStr = 'link';
                            if (!uid) actorId = 'anon_' + shareId.substring(0, 6);
                        } else {
                            console.log(`[CollabJoin] File NOT found via LINK strategy`);
                        }
                    } else {
                        console.log(`[CollabJoin] Link token hash mismatch`);
                    }
                } else {
                    console.log(`[CollabJoin] Link disabled or expired`);
                }
            } else {
                console.log(`[CollabJoin] Link doc not found: ${shareId}`);
            }
        } else {
            console.log(`[CollabJoin] No shareId/linkToken provided`);
        }

        // ----------------------------------------------------------------
        // 2. AUTHENTICATED ACCESS STRATEGY (If not found via link)
        // ----------------------------------------------------------------
        if (!fileDoc && uid) {
            console.log(`[CollabJoin] Trying AUTH strategy: uid=${uid}, parentFolderId=${parentFolderId}`);
            // A. Try User's Own Scope
            const myDoc = await findFileDoc(uid, fileId, parentFolderId);
            if (myDoc && myDoc.exists) {
                console.log(`[CollabJoin] Found file in user's OWN scope`);
                fileDoc = myDoc;
            } else {
                console.log(`[CollabJoin] Not in user's own scope, checking Shared Index...`);
                // B. Try Shared Index (Shared WITH this user)
                const sharedSnap = await firestore.collection('userSharedIndex').doc(uid).collection('items').doc(fileId).get();
                console.log(`[CollabJoin] Shared Index exists: ${sharedSnap.exists}`);
                if (sharedSnap.exists) {
                    const sharedData = sharedSnap.data()!;
                    console.log(`[CollabJoin] Shared Index data:`, JSON.stringify(sharedData));
                    if (sharedData.owner) {
                        console.log(`[CollabJoin] Using findFileDocByOwnerAndId for owner ${sharedData.owner}`);
                        // Industry-correct: resolve by (ownerUid, fileId) ONLY
                        // Never use parentFolderId for shared file access
                        fileDoc = await findFileDocByOwnerAndId(sharedData.owner, fileId);
                        if (fileDoc && fileDoc.exists) {
                            console.log(`[CollabJoin] Found file via Shared Index!`);
                            // Get the shared role from the index
                            if (sharedData.role === 'edit') role = 'edit';
                            else role = 'view';
                        } else {
                            console.log(`[CollabJoin] File NOT found in owner's scope`);
                        }
                    }
                }
            }
        } else if (!fileDoc) {
            console.log(`[CollabJoin] No uid provided, skipping AUTH strategy`);
        }

        // ----------------------------------------------------------------
        // 3. GLOBAL FALLBACK (Last Resort)
        // ----------------------------------------------------------------
        if (!fileDoc) {
            console.log(`[CollabJoin] Trying GLOBAL FALLBACK strategy`);
            // A. Check Root 'files' collection (Cheaper, no index needed)
            const rootFileDoc = await firestore.collection('files').doc(fileId).get();
            if (rootFileDoc.exists) {
                console.log(`[CollabJoin] Found file in global 'files' collection`);
                fileDoc = rootFileDoc;
            } else {
                // B. Nested Files (requires 'id' field index on CollectionGroup)
                try {
                    console.log(`[CollabJoin] Trying collectionGroup query...`);
                    const q = await firestore.collectionGroup('files').where('id', '==', fileId).limit(1).get();
                    if (!q.empty) {
                        console.log(`[CollabJoin] Found via collectionGroup('files')`);
                        fileDoc = q.docs[0];
                    } else {
                        const q2 = await firestore.collectionGroup('children').where('id', '==', fileId).limit(1).get();
                        if (!q2.empty) {
                            console.log(`[CollabJoin] Found via collectionGroup('children')`);
                            fileDoc = q2.docs[0];
                        }
                    }
                } catch (e) {
                    console.warn("[CollabJoin] CollectionGroup query failed (missing index?):", e);
                }
            }
        }

        if (!fileDoc || !fileDoc.exists) {
            console.warn(`[CollabJoin] FINAL: File ${fileId} not found. uid=${uid}, shareId=${shareId}, parentFolderId=${parentFolderId}`);
            return res.status(404).json({ error: 'File not found' });
        }

        console.log(`[CollabJoin] SUCCESS: File found at path: ${fileDoc.ref.path}`);

        // ----------------------------------------------------------------
        // 4. VERIFY PERMISSIONS (If not already set by Link)
        // ----------------------------------------------------------------
        if (!role && uid) {
            const roleResult = await getEffectiveRole(uid, fileDoc);
            if (roleResult) {
                role = roleResult;
            }
        }

        if (!role) {
            // Permission denied
            logAudit({
                actor: actorId,
                action: 'yjs_denied',
                resourceId: fileId,
                resourceType: 'file',
                meta: { reason: 'No permission', ip: req.ip }
            });
            return res.status(403).json({ error: 'Access denied' });
        }

        // 2. Create Session
        const sessionId = admin.firestore().collection('collabSessions').doc().id;
        const now = admin.firestore.Timestamp.now();
        const expiresAt = new admin.firestore.Timestamp(now.seconds + 600, 0); // 10 mins

        await firestore.collection('collabSessions').doc(sessionId).set({
            fileId,
            actorUid: actorId, // uid or anon_ID
            role,
            via: verifiedViaStr,
            shareId: shareId || null, // Track which link was used (for revocation)
            createdAt: now,
            expiresAt,
            revoked: false,
            ip: req.ip,
            userAgent: req.headers['user-agent'] || 'unknown'
        });

        // 3. Issue Token
        const payload = {
            sid: sessionId,
            fid: fileId,
            role,
            uid: actorId
        };

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '10m' });

        // 4. Audit
        logAudit({
            actor: actorId,
            action: 'yjs_join',
            resourceId: fileId,
            resourceType: 'file',
            meta: { sessionId, role, via: verifiedViaStr }
        });

        res.json({ token, role, sessionId });

    } catch (err: any) {
        console.error('Collab join failed:', err);
        console.error(err.stack);
        res.status(500).json({ error: 'Join failed', details: err.message });
    }
});

export default router;
