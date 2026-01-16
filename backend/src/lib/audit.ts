import winston from 'winston';
import { firestore } from './storage';
import * as admin from 'firebase-admin';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    defaultMeta: { service: 'pdf-reader-backend' },
    transports: [
        new winston.transports.File({ filename: 'audit-error.log', level: 'error' }),
        new winston.transports.File({ filename: 'audit.log' }),
    ],
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple(),
    }));
}

export interface AuditEntry {
    actor: string; // uid or 'anonymous'
    action: 'view' | 'edit' | 'download' | 'share_create' | 'share_access' | 'share_update' | 'share_revoke' | 'share_cleanup' | 'zip_download' | 'yjs_join' | 'yjs_connect' | 'yjs_denied' | 'yjs_update' | 'yjs_snapshot' | 'file_upload' | 'file_delete' | 'folder_create' | 'folder_delete';
    resourceId: string;
    resourceType: 'file' | 'folder' | 'shareLink';
    meta?: any;
    timestamp?: any;
}

// Lazy lookup + logging to correct location
export async function logAudit(entry: AuditEntry) {
    // 1. File/Console Log (Backup)
    logger.info({
        ...entry,
        timestamp: new Date().toISOString()
    });

    // 2. Firestore Organized Log
    try {
        const payload = {
            ...entry,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        };

        if (entry.resourceType === 'shareLink') {
            await firestore.collection('shareLinks').doc(entry.resourceId).collection('auditLogs').add(payload);
        } else {
            // File or Folder
            // We need to find the document reference to add a subcollection.
            // Strategy: Try global ID lookup via Collection Group (most robust)
            // We search 'files', 'rootFolders', 'children' collections?
            // Since we use ID, we can try robust search.

            const resourceId = entry.resourceId;
            let ref = null;

            // Try to find the document. 
            // Note: This logic duplicates lookup, but logging is "best effort".

            // Try 'files' collection (Root files of all users? No, 'files' is subcollection of user)
            // We can use collectionGroup query on 'files' and 'children' and 'rootFolders'.

            // Optimize: If meta contains 'ownerId', strictly use it.
            if (entry.meta?.ownerId) {
                // Construct path? Hard without folder structure.
                // Just use query constrained by owner?
            }

            // We'll execute a broad search.
            // Note: 'files' collection ID is 'files' in 'users/{uid}/files'.
            const filesQuery = await firestore.collectionGroup('files').where('id', '==', resourceId).limit(1).get();
            if (!filesQuery.empty) {
                ref = filesQuery.docs[0].ref;
            } else {
                const childrenQuery = await firestore.collectionGroup('children').where('id', '==', resourceId).limit(1).get();
                if (!childrenQuery.empty) {
                    ref = childrenQuery.docs[0].ref;
                } else {
                    const foldersQuery = await firestore.collectionGroup('rootFolders').where('id', '==', resourceId).limit(1).get();
                    if (!foldersQuery.empty) {
                        ref = foldersQuery.docs[0].ref;
                    }
                }
            }

            if (ref) {
                await ref.collection('auditLogs').add(payload);
            } else {
                // Fallback: If doc deleted or not found, log to 'orphanedLogs' or 'shareLogs' (legacy)?
                // User wants to avoid root logs. We'll drop or log error?
                // Let's log to 'shareLogs' as fallback so we don't lose data.
                await firestore.collection('shareLogs').add(payload);
            }
        }

    } catch (e) {
        console.error('Audit Log Firestore Error:', e);
    }
}
