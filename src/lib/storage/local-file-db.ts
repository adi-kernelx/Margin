
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LocalFile, LocalAnnotationsBackup, PendingSave } from '../../types/editor-types';

interface PDFEditorLocalDB extends DBSchema {
    localFiles: {
        key: string;
        value: LocalFile;
    };
    localAnnotationsBackup: {
        key: string;
        value: LocalAnnotationsBackup;
    };
    pendingSaves: {
        key: string;
        value: PendingSave;
    };
}

export class LocalFileDB {
    private dbPromise: Promise<IDBPDatabase<PDFEditorLocalDB>>;

    constructor() {
        this.dbPromise = openDB<PDFEditorLocalDB>('pdf-editor-local', 1, {
            upgrade(db) {
                if (!db.objectStoreNames.contains('localFiles')) {
                    db.createObjectStore('localFiles', { keyPath: 'localFileId' });
                }
                if (!db.objectStoreNames.contains('localAnnotationsBackup')) {
                    db.createObjectStore('localAnnotationsBackup', { keyPath: 'localFileId' });
                }
                if (!db.objectStoreNames.contains('pendingSaves')) {
                    db.createObjectStore('pendingSaves', { keyPath: 'localFileId' });
                }
            },
        });
    }

    async getLocalFile(localFileId: string): Promise<LocalFile | undefined> {
        return (await this.dbPromise).get('localFiles', localFileId);
    }

    async findLocalFileByFingerprint(fingerprint: string): Promise<LocalFile | undefined> {
        const db = await this.dbPromise;
        let cursor = await db.transaction('localFiles').store.openCursor();
        while (cursor) {
            if (cursor.value.pdfFingerprint === fingerprint) {
                return cursor.value;
            }
            cursor = await cursor.continue();
        }
        return undefined;
    }

    async updateLocalFile(localFileId: string, patch: Partial<LocalFile>): Promise<void> {
        const db = await this.dbPromise;
        const tx = db.transaction('localFiles', 'readwrite');
        const store = tx.objectStore('localFiles');
        const existing = await store.get(localFileId);

        if (existing) {
            await store.put({ ...existing, ...patch, updatedAt: Date.now() });
        } else {
            // If not existing, we can't patch. But maybe we should allow upsert?
            // Prompt updateLocalFile was specifically update.
            // Let's keep it separate or allow upsert if patch has keys?
        }
        await tx.done;
    }

    async createLocalFile(file: LocalFile): Promise<void> {
        await (await this.dbPromise).put('localFiles', file);
    }

    async saveBackup(backup: LocalAnnotationsBackup): Promise<void> {
        await (await this.dbPromise).put('localAnnotationsBackup', backup);
    }

    async getBackup(localFileId: string): Promise<LocalAnnotationsBackup | undefined> {
        return (await this.dbPromise).get('localAnnotationsBackup', localFileId);
    }

    async savePending(pending: PendingSave): Promise<void> {
        await (await this.dbPromise).put('pendingSaves', pending);
    }

    async savePageOcr(localFileId: string, pageNum: number, data: any): Promise<void> {
        const db = await this.dbPromise;
        const tx = db.transaction('localFiles', 'readwrite');
        const store = tx.objectStore('localFiles');
        const file = await store.get(localFileId);

        if (file) {
            const ocrData = file.ocrData || {};
            ocrData[pageNum] = data;
            await store.put({ ...file, ocrData, updatedAt: Date.now() });
        } else {
            // File doesn't exist yet - create a minimal entry
            console.log('[LocalFileDB] Creating new file entry for OCR:', localFileId);
            await store.put({
                localFileId,
                pdfFingerprint: localFileId, // Use fileId as fingerprint if not provided
                displayName: 'Unknown',
                autosaveEnabled: false,
                autosaveIntervalSec: 10,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                ocrData: { [pageNum]: data }
            } as LocalFile);
        }
        await tx.done;
    }

    /**
     * Find OCR cache by PDF fingerprint (more robust than fileId)
     */
    async getOcrCacheByFingerprint(fingerprint: string): Promise<Record<number, any> | null> {
        const file = await this.findLocalFileByFingerprint(fingerprint);
        if (file && file.ocrData && Object.keys(file.ocrData).length > 0) {
            console.log('[LocalFileDB] Found OCR cache by fingerprint:', fingerprint);
            return file.ocrData;
        }
        return null;
    }
}

export const localFileDB = new LocalFileDB();
