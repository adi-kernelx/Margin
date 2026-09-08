// IndexedDB persistence for the local file tree.
//
// Kept in its own database rather than sharing 'pdf-editor-local' so the
// annotation/OCR cache schema in local-file-db.ts stays untouched. Folder and
// file metadata live in separate stores from the PDF bytes, so listing a
// folder never has to read a single blob.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { ROOT_FOLDER_ID, type LibraryFile, type LibraryFolder } from '@/types/library';

interface LibraryDBSchema extends DBSchema {
    folders: {
        key: string;
        value: LibraryFolder;
        indexes: { byParent: string };
    };
    files: {
        key: string;
        value: LibraryFile;
        indexes: { byParent: string };
    };
    blobs: {
        key: string;
        value: { id: string; blob: Blob };
    };
}

const DB_NAME = 'margin-library';
const DB_VERSION = 1;

class LibraryDB {
    private dbPromise: Promise<IDBPDatabase<LibraryDBSchema>>;

    constructor() {
        this.dbPromise = openDB<LibraryDBSchema>(DB_NAME, DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains('folders')) {
                    const folders = db.createObjectStore('folders', { keyPath: 'id' });
                    folders.createIndex('byParent', 'parentFolderId');
                }
                if (!db.objectStoreNames.contains('files')) {
                    const files = db.createObjectStore('files', { keyPath: 'id' });
                    files.createIndex('byParent', 'parentFolderId');
                }
                if (!db.objectStoreNames.contains('blobs')) {
                    db.createObjectStore('blobs', { keyPath: 'id' });
                }
            },
        });
    }

    /** Creates the root folder on first run. Safe to call on every startup. */
    async ensureRoot(): Promise<LibraryFolder> {
        const db = await this.dbPromise;
        const existing = await db.get('folders', ROOT_FOLDER_ID);
        if (existing) return existing;

        const now = Date.now();
        const root: LibraryFolder = {
            id: ROOT_FOLDER_ID,
            name: 'My Files',
            parentFolderId: null,
            createdAt: now,
            updatedAt: now,
        };
        await db.put('folders', root);
        return root;
    }

    // ---- folders -------------------------------------------------------

    async listChildFolders(parentFolderId: string): Promise<LibraryFolder[]> {
        const db = await this.dbPromise;
        const rows = await db.getAllFromIndex('folders', 'byParent', parentFolderId);
        return rows.sort((a, b) => a.name.localeCompare(b.name));
    }

    async getFolder(id: string): Promise<LibraryFolder | undefined> {
        return (await this.dbPromise).get('folders', id);
    }

    async createFolder(name: string, parentFolderId: string): Promise<LibraryFolder> {
        const now = Date.now();
        const folder: LibraryFolder = {
            id: crypto.randomUUID(),
            name,
            parentFolderId,
            createdAt: now,
            updatedAt: now,
        };
        await (await this.dbPromise).put('folders', folder);
        return folder;
    }

    async renameFolder(id: string, name: string): Promise<void> {
        const db = await this.dbPromise;
        const existing = await db.get('folders', id);
        if (!existing) return;
        await db.put('folders', { ...existing, name, updatedAt: Date.now() });
    }

    /**
     * Deletes a folder and everything beneath it, blobs included.
     *
     * Collects the subtree first so the whole delete runs as one pass; the
     * recursion is over folder ids, which are few, not over file rows.
     */
    async deleteFolderRecursive(id: string): Promise<void> {
        if (id === ROOT_FOLDER_ID) return;
        const db = await this.dbPromise;

        const folderIds: string[] = [];
        const queue = [id];
        while (queue.length) {
            const current = queue.shift()!;
            folderIds.push(current);
            const children = await db.getAllFromIndex('folders', 'byParent', current);
            queue.push(...children.map((f) => f.id));
        }

        for (const folderId of folderIds) {
            const files = await db.getAllFromIndex('files', 'byParent', folderId);
            for (const file of files) {
                await db.delete('blobs', file.id);
                await db.delete('files', file.id);
            }
            await db.delete('folders', folderId);
        }
    }

    // ---- files ---------------------------------------------------------

    async listFiles(parentFolderId: string): Promise<LibraryFile[]> {
        const db = await this.dbPromise;
        const rows = await db.getAllFromIndex('files', 'byParent', parentFolderId);
        return rows.sort((a, b) => a.name.localeCompare(b.name));
    }

    async importFile(source: File, parentFolderId: string): Promise<LibraryFile> {
        const db = await this.dbPromise;
        const now = Date.now();
        const entry: LibraryFile = {
            id: crypto.randomUUID(),
            name: source.name,
            parentFolderId,
            createdAt: now,
            updatedAt: now,
            mimeType: source.type || 'application/pdf',
            sizeBytes: source.size,
            status: 'ready',
            storageType: 'local',
        };
        await db.put('blobs', { id: entry.id, blob: source });
        await db.put('files', entry);
        return entry;
    }

    async getFileBlob(id: string): Promise<Blob | undefined> {
        return (await this.dbPromise).get('blobs', id).then((row) => row?.blob);
    }

    async renameFile(id: string, name: string): Promise<void> {
        const db = await this.dbPromise;
        const existing = await db.get('files', id);
        if (!existing) return;
        await db.put('files', { ...existing, name, updatedAt: Date.now() });
    }

    async deleteFile(id: string): Promise<void> {
        const db = await this.dbPromise;
        await db.delete('blobs', id);
        await db.delete('files', id);
    }
}

export const libraryDB = new LibraryDB();
