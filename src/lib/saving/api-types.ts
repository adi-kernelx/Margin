
// ============================================================
// API Types for Cloud Save with Conflict Detection
// ============================================================

export interface AnnotationSaveRequest {
    fileId: string;
    parentFolderId: string;
    clientBaseHash: string | null;
    intent: 'save' | 'autosave' | 'flatten';
}

export interface AnnotationSaveResponse {
    ok: boolean;
    conflict?: boolean;
    uploadUrl?: string;
    lastHash?: string | null;
    // Conflict details
    serverHash?: string;
    serverSavedAt?: string;
    message?: string;
}

export interface AnnotationConfirmRequest {
    fileId: string;
    parentFolderId: string;
    payloadHash: string;
}

export interface ForceSaveRequest {
    fileId: string;
    parentFolderId: string;
    payloadHash: string;
}

export interface SaveCopyRequest {
    fileId: string;
    parentFolderId: string;
    displayName?: string;
}

export interface SaveCopyResponse {
    ok: boolean;
    newFileId: string;
    newAnnotationId: string;
    displayName: string;
    uploadUrl: string;
}

export interface AnnotationLoadResponse {
    downloadUrl: string;
    annotationId: string;
    hash: string | null;
}

export interface BackendClient {
    // Conflict-aware save request
    requestSaveWithConflictCheck(req: AnnotationSaveRequest): Promise<AnnotationSaveResponse>;

    // Confirm after successful upload
    confirmSave(req: AnnotationConfirmRequest): Promise<{ ok: boolean; newHash: string }>;

    // Force save (bypass conflict)
    forceSave(req: ForceSaveRequest): Promise<{ ok: boolean; uploadUrl: string }>;

    // Save as copy
    saveCopy(req: SaveCopyRequest): Promise<SaveCopyResponse>;

    // Other operations
    requestFlatten(fileId: string, parentFolderId: string, annotations?: any): Promise<{ downloadUrl: string }>;
    requestPackageDownload(fileId: string, parentFolderId: string): Promise<{ url: string }>;

    // Load annotations
    loadAnnotations(fileId: string, parentFolderId: string): Promise<AnnotationLoadResponse>;

    // Legacy (kept for backward compat, deprecated)
    requestSave?(req: { fileId: string; payloadHash: string }): Promise<{ uploadUrl?: string; skip?: boolean; annotationId?: string }>;
}

// Conflict info passed to UI
export interface ConflictInfo {
    fileId: string;
    parentFolderId: string;
    serverHash: string;
    serverSavedAt: string;
    localPayload: any;
    localHash: string;
}
