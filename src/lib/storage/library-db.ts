// IndexedDB persistence for the local file tree.
//
// Kept in its own database rather than sharing 'pdf-editor-local' so the
// annotation/OCR cache schema in local-file-db.ts stays untouched. Folder and
// file metadata live in separate stores from the PDF bytes, so listing a
// folder never has to read a single blob.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { ROOT_FOLDER_ID, type LibraryFile, type LibraryFolder } from '@/types/library';
import { createFileIdentity, normalizeLibraryName } from '@/core/library/references';

interface FileHandleWithPermissions extends FileSystemFileHandle {
    queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export type LibraryFileAccess =
    | { status: 'ready'; entry: LibraryFile; file: File; handle?: FileSystemFileHandle }
    | { status: 'permission-required' | 'missing-source' | 'not-found'; entry?: LibraryFile };

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
    handles: {
        key: string;
        value: { id: string; handle: FileSystemFileHandle };
    };
}

const DB_NAME = 'margin-library';
const DB_VERSION = 2;

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
                if (!db.objectStoreNames.contains('handles')) {
                    db.createObjectStore('handles', { keyPath: 'id' });
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
        const normalizedName = normalizeLibraryName(name);
        if (!normalizedName) throw new Error('Folder name cannot be empty.');
        const now = Date.now();
        const folder: LibraryFolder = {
            id: crypto.randomUUID(),
            name: normalizedName,
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
        const normalizedName = normalizeLibraryName(name);
        if (!normalizedName) return;
        await db.put('folders', { ...existing, name: normalizedName, updatedAt: Date.now() });
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
                await db.delete('handles', file.id);
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

    async listAllFiles(): Promise<LibraryFile[]> {
        const rows = await (await this.dbPromise).getAll('files');
        return rows.sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt));
    }

    async getFile(id: string): Promise<LibraryFile | undefined> {
        return (await this.dbPromise).get('files', id);
    }

    async listAllFolders(): Promise<LibraryFolder[]> {
        return (await this.dbPromise).getAll('folders');
    }

    private async findBySourceFingerprint(sourceFingerprint: string): Promise<LibraryFile | undefined> {
        return (await this.dbPromise).getAll('files').then(files =>
            files.find(file => file.sourceFingerprint === sourceFingerprint));
    }

    private async findByHandle(handle: FileSystemFileHandle): Promise<LibraryFile | undefined> {
        const db = await this.dbPromise;
        for (const row of await db.getAll('handles')) {
            try {
                if (await row.handle.isSameEntry(handle)) return db.get('files', row.id);
            } catch {
                // A stale handle must not prevent another valid reference from opening.
            }
        }
        return undefined;
    }

    async addFileReference(handle: FileSystemFileHandle, parentFolderId: string): Promise<LibraryFile> {
        const db = await this.dbPromise;
        const source = await handle.getFile();
        const sourceFingerprint = createFileIdentity(source);
        const existing = await this.findByHandle(handle) ?? await this.findBySourceFingerprint(sourceFingerprint);
        const now = Date.now();
        const entry: LibraryFile = existing ? {
            ...existing,
            name: source.name,
            mimeType: source.type || 'application/pdf',
            sizeBytes: source.size,
            storageMode: 'handle',
            sourceFingerprint,
            status: 'ready',
            updatedAt: now,
        } : {
            id: crypto.randomUUID(),
            name: source.name,
            parentFolderId,
            createdAt: now,
            updatedAt: now,
            mimeType: source.type || 'application/pdf',
            sizeBytes: source.size,
            status: 'ready',
            storageType: 'local',
            storageMode: 'handle',
            sourceFingerprint,
        };
        const tx = db.transaction(['files', 'handles', 'blobs'], 'readwrite');
        await tx.objectStore('files').put(entry);
        await tx.objectStore('handles').put({ id: entry.id, handle });
        await tx.objectStore('blobs').delete(entry.id);
        await tx.done;
        return entry;
    }

    async importFile(source: File, parentFolderId: string): Promise<LibraryFile> {
        const db = await this.dbPromise;
        const now = Date.now();
        const sourceFingerprint = createFileIdentity(source);
        const existing = await this.findBySourceFingerprint(sourceFingerprint);
        if (existing?.storageMode === 'handle') return existing;
        const entry: LibraryFile = existing ? {
            ...existing,
            name: source.name,
            mimeType: source.type || 'application/pdf',
            sizeBytes: source.size,
            storageMode: 'blob',
            sourceFingerprint,
            status: 'ready',
            updatedAt: now,
        } : {
            id: crypto.randomUUID(),
            name: source.name,
            parentFolderId,
            createdAt: now,
            updatedAt: now,
            mimeType: source.type || 'application/pdf',
            sizeBytes: source.size,
            status: 'ready',
            storageType: 'local',
            storageMode: 'blob',
            sourceFingerprint,
        };
        await db.put('blobs', { id: entry.id, blob: source });
        await db.put('files', entry);
        return entry;
    }

    async getFileBlob(id: string): Promise<Blob | undefined> {
        const access = await this.openFile(id, false);
        return access.status === 'ready' ? access.file : undefined;
    }

    async openFile(id: string, requestPermission: boolean): Promise<LibraryFileAccess> {
        const db = await this.dbPromise;
        const entry = await db.get('files', id);
        if (!entry) return { status: 'not-found' };
        const mode = entry.storageMode ?? 'blob';
        if (mode === 'blob') {
            const stored = await db.get('blobs', id);
            if (!stored) return { status: 'missing-source', entry };
            const file = stored.blob instanceof File
                ? stored.blob
                : new File([stored.blob], entry.name, { type: entry.mimeType });
            return { status: 'ready', entry, file };
        }

        const row = await db.get('handles', id);
        if (!row) return { status: 'missing-source', entry };
        const handle = row.handle as FileHandleWithPermissions;
        try {
            let permission: PermissionState = 'granted';
            if (handle.queryPermission) permission = await handle.queryPermission({ mode: 'read' });
            if (permission !== 'granted' && requestPermission && handle.requestPermission) {
                permission = await handle.requestPermission({ mode: 'read' });
            }
            if (permission !== 'granted') return { status: 'permission-required', entry };
            return { status: 'ready', entry, file: await handle.getFile(), handle };
        } catch {
            return { status: 'missing-source', entry };
        }
    }

    async renameFile(id: string, name: string): Promise<void> {
        const db = await this.dbPromise;
        const existing = await db.get('files', id);
        if (!existing) return;
        const normalizedName = normalizeLibraryName(name);
        if (!normalizedName) return;
        await db.put('files', { ...existing, name: normalizedName, updatedAt: Date.now() });
    }

    async moveFile(id: string, parentFolderId: string): Promise<void> {
        const db = await this.dbPromise;
        const existing = await db.get('files', id);
        if (!existing) return;
        await db.put('files', { ...existing, parentFolderId, updatedAt: Date.now() });
    }

    async updateFileMetadata(id: string, patch: Partial<LibraryFile>): Promise<void> {
        const db = await this.dbPromise;
        const existing = await db.get('files', id);
        if (!existing) return;
        await db.put('files', { ...existing, ...patch, updatedAt: Date.now() });
    }

    async deleteFile(id: string): Promise<void> {
        const db = await this.dbPromise;
        await db.delete('blobs', id);
        await db.delete('handles', id);
        await db.delete('files', id);
    }
}

export const libraryDB = new LibraryDB();
