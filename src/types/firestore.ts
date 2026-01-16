
import { Timestamp } from 'firebase/firestore';

export interface FirestoreFolder {
    id: string;
    name: string;
    parentFolderId: string | null; // null for Root
    createdAt: Timestamp;
    updatedAt: Timestamp;
    ownerUid: string;
}

export interface FirestoreFileMetadata {
    id: string;
    name: string;
    parentFolderId: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    ownerUid: string;
    mimeType: string | null; // "application/pdf"
    status: 'empty' | 'uploading' | 'synced' | 'failed';
    s3Key?: string | null;
    size?: number | null;
    uploadedAt?: Timestamp | null;

    // === Step A1: Annotation sidecar & Save Behavior ===
    annotationsRef: string | null; // "annotations/{annotationId}/latest.json"
    lastAnnotationsHash: string | null; // SHA-256

    lastSavedAt: Timestamp | null;

    autosaveEnabled: boolean;        // default: false
    autosaveIntervalSec: number;     // cloud default: 60

    saveStatus: "idle" | "saving" | "error";

    // === Step 6.2: Sharing & Permissions ===
    acl: Record<string, {
        role: "owner" | "editor" | "viewer";
        addedAt: Timestamp;
    }>;
    sharedWith: string[]; // denormalized for queries
    isShared: boolean;

    storageType: "cloud";            // explicit for cloud files
}

export type FileRole = "owner" | "editor" | "viewer";

export interface FilePermission {
    role: FileRole;
    addedAt: Timestamp;
}
