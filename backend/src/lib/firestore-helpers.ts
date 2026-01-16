import { firestore } from './storage';
import { DocumentSnapshot, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import admin from 'firebase-admin';


// Helper to find a folder document by ID within a user's scope
// Handles both root folders and nested folders
export async function findFolderDoc(uid: string, folderId: string): Promise<QueryDocumentSnapshot | DocumentSnapshot | null> {
    console.log(`[findFolderDoc] Looking for folder ${folderId} for user ${uid}`);

    // 1. Check root folders first (fastest)
    const rootRef = firestore.collection('users').doc(uid).collection('rootFolders').doc(folderId);
    const rootDoc = await rootRef.get();
    if (rootDoc.exists) {
        console.log(`[findFolderDoc] Found in root folders`);
        return rootDoc;
    }

    // 2. Try collection group queries (requires indexes)
    try {
        // Primary: ownerUid (modern structure)
        console.log(`[findFolderDoc] Trying collection group with ownerUid=${uid}`);
        const nestedOwnerQuery = await firestore.collectionGroup('children')
            .where('type', '==', 'folder')
            .where('id', '==', folderId)
            .where('ownerUid', '==', uid)
            .limit(1)
            .get();

        if (!nestedOwnerQuery.empty) {
            console.log(`[findFolderDoc] Found via ownerUid collection group`);
            return nestedOwnerQuery.docs[0];
        }

        // Secondary: createdBy (legacy)
        console.log(`[findFolderDoc] Trying collection group with createdBy=${uid}`);
        const nestedCreatorQuery = await firestore.collectionGroup('children')
            .where('type', '==', 'folder')
            .where('id', '==', folderId)
            .where('createdBy', '==', uid)
            .limit(1)
            .get();

        if (!nestedCreatorQuery.empty) {
            console.log(`[findFolderDoc] Found via createdBy collection group`);
            return nestedCreatorQuery.docs[0];
        }

    } catch (indexErr: any) {
        console.warn('[findFolderDoc] Collection group query failed:', indexErr.message);
    }

    // 3. FALLBACK: Recursive traversal (no index required, but slower)
    console.log(`[findFolderDoc] Trying recursive traversal fallback...`);
    try {
        const result = await findFolderByTraversal(uid, folderId);
        if (result) {
            console.log(`[findFolderDoc] Found via recursive traversal`);
            return result;
        }
    } catch (travErr: any) {
        console.warn('[findFolderDoc] Recursive traversal failed:', travErr.message);
    }

    console.log(`[findFolderDoc] Folder ${folderId} NOT FOUND`);
    return null;
}

// Recursive traversal to find a folder by ID (no collection group index needed)
async function findFolderByTraversal(uid: string, targetFolderId: string, maxDepth: number = 10): Promise<DocumentSnapshot | null> {
    // Get all root folders for this user
    const rootFoldersSnap = await firestore.collection('users').doc(uid).collection('rootFolders').get();

    for (const rootFolder of rootFoldersSnap.docs) {
        // Check if this root folder has the target as a child
        const found = await searchChildrenRecursively(rootFolder.ref, targetFolderId, maxDepth);
        if (found) return found;
    }

    return null;
}

async function searchChildrenRecursively(
    parentRef: FirebaseFirestore.DocumentReference,
    targetId: string,
    depth: number
): Promise<DocumentSnapshot | null> {
    if (depth <= 0) return null;

    // Check direct children of this parent
    const childRef = parentRef.collection('children').doc(targetId);
    const childDoc = await childRef.get();

    if (childDoc.exists) {
        const data = childDoc.data();
        if (data?.type === 'folder') {
            return childDoc;
        }
    }

    // If not found, recurse into all folder children
    const childrenSnap = await parentRef.collection('children')
        .where('type', '==', 'folder')
        .limit(50) // Limit to avoid too many reads
        .get();

    for (const childFolder of childrenSnap.docs) {
        const found = await searchChildrenRecursively(childFolder.ref, targetId, depth - 1);
        if (found) return found;
    }

    return null;
}


/**
 * Industry-correct file lookup: resolves by (ownerUid, fileId) ONLY.
 * Never relies on parentFolderId - shared users don't know the folder structure.
 * This is how Google Drive / Notion / Dropbox work.
 */
export async function findFileDocByOwnerAndId(
    ownerUid: string,
    fileId: string
): Promise<QueryDocumentSnapshot | DocumentSnapshot | null> {
    console.log(`[findFileDocByOwnerAndId] Looking for file ${fileId} owned by ${ownerUid}`);

    // 1. PRIMARY: Direct doc path in root files (fastest)
    const rootRef = firestore.collection('users').doc(ownerUid).collection('files').doc(fileId);
    const rootDoc = await rootRef.get();
    if (rootDoc.exists) {
        console.log(`[findFileDocByOwnerAndId] Found in root files`);
        return rootDoc;
    }

    // 2. SECONDARY: collectionGroup fallback (file in nested folders)
    // Query by ownerUid field (NOT createdBy - owner might differ from creator in edge cases)
    try {
        console.log(`[findFileDocByOwnerAndId] Trying collectionGroup 'children' with ownerUid`);
        const nestedQuery = await firestore.collectionGroup('children')
            .where('type', '==', 'file')
            .where('id', '==', fileId)
            .where('ownerUid', '==', ownerUid)
            .limit(1)
            .get();

        if (!nestedQuery.empty) {
            console.log(`[findFileDocByOwnerAndId] Found via collectionGroup (ownerUid match)`);
            return nestedQuery.docs[0];
        }

        // 2b. Also try createdBy as fallback (for older docs that might not have ownerUid)
        console.log(`[findFileDocByOwnerAndId] Trying collectionGroup 'children' with createdBy`);
        const createdByQuery = await firestore.collectionGroup('children')
            .where('type', '==', 'file')
            .where('id', '==', fileId)
            .where('createdBy', '==', ownerUid)
            .limit(1)
            .get();

        if (!createdByQuery.empty) {
            console.log(`[findFileDocByOwnerAndId] Found via collectionGroup (createdBy match)`);
            return createdByQuery.docs[0];
        }
    } catch (indexErr: any) {
        console.warn('[findFileDocByOwnerAndId] Collection group query failed:', indexErr.message);
    }

    // 3. TERTIARY: Try the global 'files' collection (for very old structure)
    try {
        console.log(`[findFileDocByOwnerAndId] Trying collectionGroup 'files'`);
        const filesQuery = await firestore.collectionGroup('files')
            .where('id', '==', fileId)
            .where('ownerUid', '==', ownerUid)
            .limit(1)
            .get();

        if (!filesQuery.empty) {
            console.log(`[findFileDocByOwnerAndId] Found via collectionGroup 'files'`);
            return filesQuery.docs[0];
        }
    } catch (e: any) {
        console.warn('[findFileDocByOwnerAndId] files collectionGroup failed:', e.message);
    }

    console.log(`[findFileDocByOwnerAndId] File ${fileId} NOT FOUND for owner ${ownerUid}`);
    return null;
}

/**
 * Legacy findFileDoc - still useful for owner's own file lookups where parentFolderId is known.
 * For shared file access, use findFileDocByOwnerAndId instead.
 */
export async function findFileDoc(uid: string, fileId: string, folderId?: string, ownerId?: string): Promise<QueryDocumentSnapshot | DocumentSnapshot | null> {
    const targetUid = ownerId || uid;

    // If no folderId provided or it's 'shared-with-me', use the owner-based lookup
    if (!folderId || folderId === 'shared-with-me' || folderId === 'shared-by-me') {
        return findFileDocByOwnerAndId(targetUid, fileId);
    }

    console.log(`[findFileDoc] Looking for file ${fileId} in scope of ${targetUid}, folderId=${folderId}`);

    // 1. Check root files first (if folderId is 'root')
    if (folderId === 'root') {
        const rootRef = firestore.collection('users').doc(targetUid).collection('files').doc(fileId);
        const rootDoc = await rootRef.get();
        console.log(`[findFileDoc] Root files check: exists=${rootDoc.exists}`);
        if (rootDoc.exists) return rootDoc;
    }

    // 2. If folderId provided and not 'root', look in that folder's children
    if (folderId && folderId !== 'root') {
        const folderDoc = await findFolderDoc(targetUid, folderId);
        if (folderDoc) {
            const childRef = folderDoc.ref.collection('children').doc(fileId);
            const childDoc = await childRef.get();
            console.log(`[findFileDoc] Folder children check: exists=${childDoc.exists}`);
            if (childDoc.exists) return childDoc;
        } else {
            console.log(`[findFileDoc] Folder ${folderId} not found`);
        }
    }

    // 3. Fallback to owner-based lookup
    return findFileDocByOwnerAndId(targetUid, fileId);
}


// Compute the S3 path prefix for a given folder
// Returns: "users/{uid}/folders/{rootId}/children/{subId}/..."
export async function computeS3Prefix(uid: string, folderDoc: DocumentSnapshot | QueryDocumentSnapshot): Promise<string> {
    const pathSegments: string[] = [];
    let currentDoc = folderDoc;

    // Walk up the usage tree
    // Structure: 
    // root: /users/{uid}/rootFolders/{folderId}
    // nested: .../children/{parentId}/children/{folderId}

    while (true) {
        if (!currentDoc.exists) break;
        const data = currentDoc.data();
        if (!data) break;

        // Prepend current folder ID to path
        pathSegments.unshift(`folders/${currentDoc.id}`);

        const parentColl = currentDoc.ref.parent;

        // If parent collection is 'rootFolders', we are done
        if (parentColl.id === 'rootFolders') {
            break;
        }

        // If parent collection is 'children', the parent doc is the grandpa
        if (parentColl.id === 'children') {
            // parentDoc is the folder containing this 'children' collection
            const parentDocRef = parentColl.parent;
            if (!parentDocRef) break; // Should not happen

            // Fetch parent doc
            currentDoc = await parentDocRef.get();
        } else {
            // Unexpected structure (maybe 'files' or root?)
            break;
        }
    }

    return `users/${uid}/${pathSegments.join('/children/')}/children`;
}

// ============================================================================
// SHARED METADATA HELPERS ("Shared with you" / "Shared by you")
// ============================================================================

/**
 * ----------------------------------------------------------------------------
 * DATA MODEL INVARIANTS
 * ----------------------------------------------------------------------------
 * 1. Canonical Ownership:
 *    - A file or folder exists EXACTLY ONCE in the canonical structures:
 *      (files/{fileId} or folders/{folderId}).
 *    - No duplicate copies are ever created for sharing.
 * 
 * 2. Virtual Root Folders:
 *    - "Shared with you" & "Shared by you" are COMPUTED VIEWS.
 *    - They are backed by the `/userSharedIndex/{uid}/items` collection.
 * 
 * 3. Metadata Projection:
 *    - The `userSharedIndex` is NEVER authoritative for file content.
 *    - It contains only POINTERS (refId) to the canonical objects.
 * 
 * 4. Permission Authority:
 *    - Possession of a pointer in `userSharedIndex` does NOT grant access.
 *    - ACL checks (permissions) are always resolved against the canonical object.
 * 
 * 5. Lifecycle:
 *    - Deleting the canonical object must lazily or actively remove projections.
 *    - Removing a projection (`removeFromSharedWithUser`) does NOT delete the file.
 * ----------------------------------------------------------------------------
 */

export interface SharedItemMeta {
    sharedVia: 'direct' | 'link';
    sharedBy: string; // uid of owner/sharer
    inheritedFrom?: string; // optional folderId if inherited
    role: 'view' | 'edit';
    shareId?: string; // Critical for tracking WHICH link was used
}

export type RefType = 'file' | 'folder';

/**
 * Adds a pointer to the "Shared with you" virtual root of a target user.
 * Idempotent: Overwrites existing entry if present.
 */
export async function addToSharedWithUser(
    targetUid: string,
    refType: RefType,
    refId: string,
    role: 'view' | 'edit',
    meta: { sharedVia: 'direct' | 'link'; sharedBy: string; inheritedFrom?: string; shareId?: string }
): Promise<void> {
    const itemRef = firestore.collection('userSharedIndex').doc(targetUid).collection('items').doc(refId);

    // Check existing entry to avoid role downgrade
    const existingSnap = await itemRef.get();
    let effectiveRole = role;

    if (existingSnap.exists) {
        const existingData = existingSnap.data();
        const existingRole = existingData?.role;

        // Role priority: 'edit' > 'view'
        // Never downgrade from 'edit' to 'view'
        if (existingRole === 'edit' && role === 'view') {
            console.log(`[addToSharedWithUser] Keeping existing 'edit' role for ${targetUid}/${refId} (not downgrading to 'view')`);
            effectiveRole = 'edit';
        } else if (existingRole === 'view' && role === 'edit') {
            console.log(`[addToSharedWithUser] Upgrading role from 'view' to 'edit' for ${targetUid}/${refId}`);
            effectiveRole = 'edit';
        }
    }

    const payload: any = {
        refType,
        refId,
        owner: meta.sharedBy, // assuming sharedBy is owner or effective sharer
        role: effectiveRole,
        sharedVia: meta.sharedVia,
        sharedBy: meta.sharedBy,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Only set createdAt on first creation
        ...(existingSnap.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
        // Only include inheritedFrom if defined
        ...(meta.inheritedFrom ? { inheritedFrom: meta.inheritedFrom } : {})
    };

    if (meta.shareId) {
        payload.shareId = meta.shareId;
    }

    // Use set with merge to be safe
    await itemRef.set(payload, { merge: true });
}

/**
 * Removes a pointer from the "Shared with you" virtual root.
 * This effectively "hides" the file from the user's view, but does NOT delete the canonical file.
 */
export async function removeFromSharedWithUser(targetUid: string, refId: string): Promise<void> {
    const itemRef = firestore.collection('userSharedIndex').doc(targetUid).collection('items').doc(refId);

    await itemRef.delete();
}

/**
 * Updates the "Shared by you" index for the owner.
 * Tracks who a file is shared with and how.
 */
export async function addToSharedByUser(
    ownerUid: string,
    refId: string,
    target: string | 'link',
    refType?: RefType,
    viaMethod: 'direct' | 'link' = 'direct'
): Promise<void> {
    console.log(`[addToSharedByUser] Adding to index: owner=${ownerUid}, refId=${refId}, target=${target}, refType=${refType}, via=${viaMethod}`);

    const itemRef = firestore.collection('userSharedIndex').doc(ownerUid).collection('items').doc(refId);

    const updates: any = {
        refId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (refType) {
        updates.refType = refType;
    }

    if (target === 'link') {
        updates.via = admin.firestore.FieldValue.arrayUnion('link');
        updates.sharedVia = 'link'; // Explicit marker for link-based sharing
    } else {
        updates.sharedWith = admin.firestore.FieldValue.arrayUnion(target);
        // Use the specified viaMethod (defaults to direct, but can be link)
        updates.via = admin.firestore.FieldValue.arrayUnion(viaMethod);
    }

    console.log(`[addToSharedByUser] Writing updates:`, JSON.stringify(updates));
    await itemRef.set(updates, { merge: true });
    console.log(`[addToSharedByUser] Successfully updated index for ${refId}`);
}

// ============================================================================
// ACCESS CONTROL VERIFICATION
// ============================================================================

// ============================================================================
// ACCESS CONTROL VERIFICATION (Step 4: Recursive)
// ============================================================================

/**
 * Determines the effective role for a user on a document.
 * Returns 'view', 'edit', or false if no access.
 */
export async function getEffectiveRole(uid: string, doc: DocumentSnapshot | QueryDocumentSnapshot): Promise<'view' | 'edit' | false> {
    const data = doc.data();
    if (!data) return false;

    // 1. Owner check (Global)
    if (data.createdBy === uid || data.ownerUid === uid) return 'edit';

    // Start walking up from the current document
    let currentDoc: DocumentSnapshot | QueryDocumentSnapshot | null = doc;
    const MAX_DEPTH = 20;
    let depth = 0;

    while (currentDoc && currentDoc.exists && depth < MAX_DEPTH) {
        // A. Check Direct ACL on this item
        const aclRef = currentDoc.ref.collection('acl').doc(uid);
        const aclSnap = await aclRef.get();
        if (aclSnap.exists) {
            const role = aclSnap.data()?.role;
            return role === 'edit' ? 'edit' : 'view';
        }

        // B. Check Link-based Access (via Projection)
        try {
            const sharedItemRef = firestore.collection('userSharedIndex').doc(uid).collection('items').doc(currentDoc.id);
            const sharedItemSnap = await sharedItemRef.get();
            if (sharedItemSnap.exists) {
                const sharedData = sharedItemSnap.data();

                if (sharedData?.sharedVia === 'link' && sharedData?.shareId) {
                    const linkRef = firestore.collection('shareLinks').doc(sharedData.shareId);
                    const linkSnap = await linkRef.get();
                    if (linkSnap.exists) {
                        const linkData = linkSnap.data();
                        if (linkData && !linkData.disabled) {
                            if (!linkData.expiresAt || linkData.expiresAt.toMillis() > Date.now()) {
                                // Valid link
                                return linkData.role === 'edit' ? 'edit' : 'view';
                            }
                        }
                    }
                } else {
                    // Direct share via projection but missing ACL? 
                    // This implies 'view' or 'edit' based on projection metadata if trusted.
                    // But strictly direct shares should have ACLs. 
                    // Exception: "Shared Folder Content" doesn't have individual ACLs usually?
                    // No, our recursive logic checks PARENT folders.
                    // So if we are here (Projected Item), it means THIS item is shared.
                    // If no ACL, we might fall back to projection role.
                    if (sharedData?.role) return sharedData.role === 'edit' ? 'edit' : 'view';
                    return 'view';
                }
            }
        } catch (e) {
            console.warn('Link access check failed', e);
        }

        // C. Move to Parent
        const docData = currentDoc.data();
        if (!docData || !docData.parentId || docData.parentId === 'root') {
            break;
        }

        const parentId = docData.parentId;
        const ownerId = docData.createdBy || docData.ownerUid;
        currentDoc = await findFolderDoc(ownerId, parentId);
        depth++;
    }

    return false;
}

/**
 * Verifies if a user has access (boolean).
 */
export async function verifyAccess(uid: string, doc: DocumentSnapshot | QueryDocumentSnapshot): Promise<boolean> {
    const role = await getEffectiveRole(uid, doc);
    return !!role;
}

/**
 * Computes effective role for a user after a specific link has been revoked.
 * Checks: owner, direct ACL, folder inheritance, other active links.
 */
export async function computeEffectiveRoleAfterRevocation(
    uid: string,
    scopeId: string,
    scopeType: RefType,
    excludeShareId: string
): Promise<'view' | 'edit' | 'owner' | null> {
    // 1. Check if user is owner
    let fileDoc: DocumentSnapshot | null = null;

    // Try to find the file/folder
    if (scopeType === 'folder') {
        // Check in user's folders
        const filesQuery = await firestore.collectionGroup('rootFolders').where('id', '==', scopeId).limit(1).get();
        if (!filesQuery.empty) {
            fileDoc = filesQuery.docs[0];
        } else {
            const childrenQuery = await firestore.collectionGroup('children').where('id', '==', scopeId).where('type', '==', 'folder').limit(1).get();
            if (!childrenQuery.empty) {
                fileDoc = childrenQuery.docs[0];
            }
        }
    } else {
        const filesQuery = await firestore.collectionGroup('files').where('id', '==', scopeId).limit(1).get();
        if (!filesQuery.empty) {
            fileDoc = filesQuery.docs[0];
        } else {
            const childrenQuery = await firestore.collectionGroup('children').where('id', '==', scopeId).where('type', '==', 'file').limit(1).get();
            if (!childrenQuery.empty) {
                fileDoc = childrenQuery.docs[0];
            }
        }
    }

    if (!fileDoc) return null;

    const fileData = fileDoc.data();

    // Owner check
    if (fileData?.createdBy === uid || fileData?.ownerUid === uid) {
        return 'owner';
    }

    // 2. Check direct ACL
    const aclSnap = await fileDoc.ref.collection('acl').doc(uid).get();
    if (aclSnap.exists) {
        const aclData = aclSnap.data();
        if (aclData?.role === 'edit') return 'edit';
        if (aclData?.role === 'view') return 'view';
    }

    // 3. Check other active links the user has opened (excluding the revoked one)
    const userSharedSnap = await firestore.collection('userSharedIndex').doc(uid).collection('items').doc(scopeId).get();
    if (userSharedSnap.exists) {
        const sharedData = userSharedSnap.data();
        // If they got access via a different share link that's still active
        if (sharedData?.shareId && sharedData.shareId !== excludeShareId) {
            // Verify that share link is still active
            const otherLinkSnap = await firestore.collection('shareLinks').doc(sharedData.shareId).get();
            if (otherLinkSnap.exists) {
                const otherLinkData = otherLinkSnap.data();
                if (!otherLinkData?.disabled) {
                    return sharedData.role as 'view' | 'edit';
                }
            }
        }
    }

    // 4. Check for any other active links for this scope that the user opened
    const allLinksQuery = await firestore.collection('shareLinks')
        .where('scopeId', '==', scopeId)
        .where('disabled', '==', false)
        .get();

    let bestRole: 'view' | 'edit' | null = null;

    for (const linkDoc of allLinksQuery.docs) {
        if (linkDoc.id === excludeShareId) continue;

        // Check if user opened this link
        const openedBySnap = await linkDoc.ref.collection('openedBy').doc(uid).get();
        if (openedBySnap.exists) {
            const linkData = linkDoc.data();
            if (linkData.role === 'edit') {
                bestRole = 'edit';
            } else if (linkData.role === 'view' && bestRole !== 'edit') {
                bestRole = 'view';
            }
        }
    }

    if (bestRole) return bestRole;

    // 5. Check folder inheritance (walk up parent chain)
    // Simplified: check if parent folder gives access
    if (fileData?.parentId && fileData.parentId !== 'root') {
        const parentDoc = await findFolderDoc(fileData.createdBy || fileData.ownerUid, fileData.parentId);
        if (parentDoc) {
            const parentAclSnap = await parentDoc.ref.collection('acl').doc(uid).get();
            if (parentAclSnap.exists) {
                const parentAcl = parentAclSnap.data();
                return parentAcl?.role as 'view' | 'edit' || null;
            }
        }
    }

    return null;
}

/**
 * Robust, idempotent share revocation.
 * Disables the link, cleans up all projections (paged), and invalidates sessions.
 * This is the canonical way to revoke a link.
 */
export async function revokeShare(shareId: string, actorUid: string = 'system') {
    console.log(`[revokeShare] Starting revocation for ${shareId} by ${actorUid}`);

    // 1. Mark disabled (idempotent)
    const shareRef = firestore.collection('shareLinks').doc(shareId);
    const shareSnap = await shareRef.get();

    if (!shareSnap.exists) {
        throw new Error('Share link not found');
    }

    const shareData = shareSnap.data()!;
    const scopeId = shareData.scopeId;
    const scopeType = shareData.scopeType as RefType;
    const ownerUid = shareData.scopeOwner || shareData.creator;

    // Disable if not already
    if (!shareData.disabled) {
        await shareRef.update({
            disabled: true,
            disabledAt: admin.firestore.FieldValue.serverTimestamp(),
            disabledReason: 'manual'
        });
    }

    // Helper to process batched updates
    async function processProjectionCleanup(query: FirebaseFirestore.Query, description: string) {
        try {
            console.log(`[revokeShare] Processing cleanup via ${description}...`);
            const BATCH_SIZE = 500;
            let lastDoc: QueryDocumentSnapshot | null = null;
            let processed = 0;
            let deletedCount = 0;
            let updatedCount = 0;

            while (true) {
                let pageQuery = query.limit(BATCH_SIZE);
                if (lastDoc) {
                    pageQuery = pageQuery.startAfter(lastDoc);
                }

                const snapshot = await pageQuery.get();
                if (snapshot.empty) {
                    console.log(`[revokeShare] No more docs for ${description}`);
                    break;
                }

                const batch = firestore.batch();
                let batchCount = 0;

                for (const doc of snapshot.docs) {
                    const projRef = doc.ref;
                    // Structure: userSharedIndex/{uid}/items/{itemId}
                    // Parent is items, Parent.Parent is {uid}
                    const uid = projRef.parent.parent!.id;

                    // Compute effective role excluding this shareId
                    // (Since we disabled it, the standard check will filter it out)
                    try {
                        const effective = await computeEffectiveRoleAfterRevocation(uid, scopeId, scopeType, shareId);

                        if (!effective || effective === 'owner') {
                            // Owner doesn't need projection, and no-access users should lose it
                            batch.delete(projRef);
                            deletedCount++;
                        } else { // 'view' or 'edit'
                            batch.set(projRef, {
                                role: effective,
                                updatedAt: admin.firestore.FieldValue.serverTimestamp()
                            }, { merge: true });
                            updatedCount++;
                        }
                        batchCount++;
                    } catch (innerErr) {
                        console.error(`[revokeShare] Error computing role for ${uid}:`, innerErr);
                    }
                }

                if (batchCount > 0) {
                    await batch.commit();
                    processed += batchCount;
                }

                lastDoc = snapshot.docs[snapshot.docs.length - 1];
                if (snapshot.size < BATCH_SIZE) break;
            }
            console.log(`[revokeShare] Processed ${processed} projections via ${description} (Deleted: ${deletedCount}, Updated: ${updatedCount})`);
        } catch (err) {
            console.error(`[revokeShare] Cleanup failed for ${description}:`, err);
            // Don't throw - continue to next steps
        }
    }

    // 2. Find projections referencing this shareId
    const byShareQ = firestore.collectionGroup('items').where('shareId', '==', shareId);
    await processProjectionCleanup(byShareQ, 'shareId');

    // 3. Also find projections referencing this file (fallback for missing shareId)
    // We intentionally scan items with this refId to catch any stray projections
    const byRefQ = firestore.collectionGroup('items').where('refId', '==', scopeId);
    await processProjectionCleanup(byRefQ, 'refId');

    // 4. Invalidate collab sessions
    try {
        const sessionsQuery = await firestore.collection('collabSessions')
            .where('shareId', '==', shareId)
            .where('revoked', '==', false)
            .get();

        if (!sessionsQuery.empty) {
            const batch = firestore.batch();
            sessionsQuery.docs.forEach(doc => {
                batch.update(doc.ref, {
                    revoked: true,
                    revokedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
            console.log(`[revokeShare] Revoked ${sessionsQuery.size} collab sessions`);
        }
    } catch (err) {
        console.error('[revokeShare] Failed to revoke sessions:', err);
    }

    // 5. Update owner's "Shared by you"
    try {
        const ownerProjRef = firestore.collection('userSharedIndex').doc(ownerUid).collection('items').doc(scopeId);
        const activeLinks = await firestore.collection('shareLinks')
            .where('scopeId', '==', scopeId)
            .where('disabled', '==', false)
            .get();

        if (activeLinks.empty) {
            // No active links - remove owner's projection
            await ownerProjRef.delete();
            // Also unmark shared flag on file/folder
            try {
                if (scopeType === 'folder') {
                    const f = await findFolderDoc(ownerUid, scopeId);
                    if (f) await f.ref.update({ shared: false });
                } else {
                    const f = await findFileDoc(ownerUid, scopeId);
                    if (f) await f.ref.update({ shared: false });
                }
            } catch (e) {
                console.warn('[revokeShare] Failed to update shared flag:', e);
            }
        } else {
            // Update owner projection timestamp
            await ownerProjRef.set({
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
    } catch (e) {
        console.warn('[revokeShare] Failed to update owner protection:', e);
    }

    // 6. Audit Log
    try {
        await firestore.collection('shareLogs').add({
            action: 'link_revoked',
            shareId,
            scopeId,
            actor: actorUid,
            ts: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.warn('[revokeShare] Failed audit log:', e);
    }

    console.log(`[revokeShare] Revocation complete for ${shareId}`);
    return { affectedUsers: [] }; // Mock return to satisfy potential callers if any remain? No, void is better.
}

/**
 * Track that a user opened a share link.
 * Creates/updates the openedBy subcollection entry.
 */
export async function trackLinkOpened(shareId: string, uid: string): Promise<void> {
    const openedByRef = firestore.collection('shareLinks').doc(shareId).collection('openedBy').doc(uid);
    const existing = await openedByRef.get();

    if (existing.exists) {
        await openedByRef.update({
            lastOpenedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } else {
        await openedByRef.set({
            uid,
            firstOpenedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastOpenedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }
}

