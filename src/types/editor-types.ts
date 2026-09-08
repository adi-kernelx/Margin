
import type { Annotation } from '../lib/annotations/models';

// A2. Client-side Local File Registry (IndexedDB)
// Local files must not pollute Firestore. All local-only state lives in IndexedDB.

export interface LocalFile {
    localFileId: string;
    pdfFingerprint: string;     // hash of PDF bytes or stable fingerprint
    displayName: string;

    // File handles (structured clone)
    // Note: These must be serializable/clonable for IndexedDB
    pdfFileHandle?: FileSystemFileHandle;
    jsonFileHandle?: FileSystemFileHandle;

    // Save behavior
    autosaveEnabled: boolean;   // default false
    autosaveIntervalSec: number; // local default: 10

    lastSavedAt?: number;
    lastAnnotationsHash?: string;
    lastFlattenSavedAt?: number;

    createdAt: number;
    updatedAt: number;

    // OCR Sidecar
    ocrData?: Record<number, OcrPageData>; // pageNum -> Data
}

export interface OcrBBox {
    x: number; // Normalized 0..1
    y: number;
    w: number;
    h: number;
}

export interface OcrToken {
    text: string;
    bbox: OcrBBox;
    confidence: number;
    fontSizeNorm: number;
}

export interface OcrPageData {
    tokens: OcrToken[];
    blocks?: any[];
    avgConfidence: number;
    detectedScript?: string;
}

export interface LocalAnnotationsBackup {
    localFileId: string;
    annotationsJSON: AnnotationData; // latest known good state
    updatedAt: number;
}

export interface PendingSave {
    localFileId: string;
    annotationsJSON: AnnotationData;
    reason: "autosave" | "manual" | "crash-recovery";
    createdAt: number;
}

// A3. Unified File Identity Model.
// Only one kind survives now that storage is local-only; the discriminant is
// kept so the editor keeps a single place to add a second backing store later.
export type EditorFile = {
    kind: "local";
    localFileId: string;
    pdfFingerprint: string;
    displayName: string;
};

// A4. Annotation state contract (shared)
// Both local and cloud save pipelines must write identical JSON.
export interface AnnotationData {
    schemaVersion: number;
    editorVersion: string;

    pageCount: number;

    objects: Annotation[]; // strokes, shapes, text, images, math

    createdAt: number;
    updatedAt: number;
}

// A5. Save state machine (defined now, implemented later)
export type SaveState =
    | "idle"
    | "dirty"
    | "saving"
    | "error";

// A6. Autosave configuration model
export const AUTOSAVE_DEFAULTS = {
    local: {
        enabled: false,
        intervalSec: 10
    },
    cloud: {
        enabled: true, // "In Cloud files, autosave if on then..."
        // User request: "Autosave- automatically execute save after every 1 minute"
        // User also said: "In Cloud files... Autosave - automatically execute...".
        // It implies enabled by default? Or just the setting?
        // "Autosave if on then..." usually implies toggle.
        // But later: "In Cloud files... Autosave- automatically execute save after every 1 minute"
        // Let's set enabled: true for cloud by default as per modern apps.
        intervalSec: 60
    }
} as const;

export type AnnotationObject = Annotation;
