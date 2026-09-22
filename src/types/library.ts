// Local library types.
//
// Replaces the Firestore-shaped types that previously described the cloud file
// tree. Timestamps are plain epoch milliseconds rather than Firestore
// Timestamps, so nothing here depends on firebase.

export type LibraryFileStatus = 'importing' | 'ready' | 'failed';

export interface LibraryFolder {
    id: string;                      // 'root' for the top level, else a UUID
    name: string;
    parentFolderId: string | null;   // null only for root
    createdAt: number;
    updatedAt: number;
}

export interface LibraryFile {
    id: string;
    name: string;
    parentFolderId: string;
    createdAt: number;
    updatedAt: number;
    mimeType: string;
    sizeBytes: number;
    status: LibraryFileStatus;
    storageType: 'local';
    /** Handle references do not copy PDF bytes into Margin. Blob is the compatibility fallback. */
    storageMode?: 'handle' | 'blob';
    sourceFingerprint?: string;
    pageCount?: number;
    lastReadPage?: number;
    coverThumbnail?: string;
    lastOpenedAt?: number;
}

export const ROOT_FOLDER_ID = 'root';
