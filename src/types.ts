export type DocID = string;

export interface DocumentEntry {
    id: DocID;
    stableId: string;      // Persistence ID (fingerprint)
    name: string;
    parentFolderId?: string;
    fileUrl: string;       // Object URL
    file?: File;           // The actual file object
    fileHandle?: any;      // FileSystemFileHandle
    fileSource?: 'local' | 'remote';
    currentTool?: string | null;
    role?: 'owner' | 'editor' | 'viewer';
    pdfFingerprint?: string;  // PDF fingerprint from pdf.js for search
}
