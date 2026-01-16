
import { create } from 'zustand';
import { type EditorFile, type AnnotationData, AUTOSAVE_DEFAULTS } from '../../types/editor-types';
import { type SaveReason, type SaveResult, type SaveInit, type SaveAdapter } from './types';
import { FileSaveController } from './file-save-controller';
import { LocalSaveAdapter } from './local-save-adapter';
import type { ConflictInfo } from './api-types';

// ============================================
// Types (Compat + New)
// ============================================

export type SaveStatus = 'idle' | 'saving' | 'done' | 'error' | 'conflict';

export interface SaveStoreState {
    fileHandleByPdf: Record<string, FileSystemFileHandle | null>;
    isDirtyByPdf: Record<string, boolean>;
    autosaveEnabledByPdf: Record<string, boolean>;
    permissionGrantedByPdf: Record<string, boolean>;
    saveStatusByPdf: Record<string, SaveStatus>;
    needsUserAction: Record<string, { reason: 'no-handle' | 'no-permission' | 'error' | 'timeout'; message?: string; firstSeen?: number } | null>;
    lastModifiedMsByPdf: Record<string, number>;
    lastSavedMsByPdf: Record<string, number>;

    // Conflict tracking
    conflictByPdf: Record<string, ConflictInfo | null>;

    // Actions
    setSaveStatus: (id: string, status: SaveStatus) => void;
    setFileHandle: (id: string, handle: FileSystemFileHandle) => void;
    setPermissionGranted: (id: string, granted: boolean) => void;
    setAutosaveEnabled: (id: string, enabled: boolean) => void;
    setNeedsUserAction: (id: string, action: any) => void;
    setConflict: (id: string, conflict: ConflictInfo | null) => void;
    clearDoc: (id: string) => void;
}

export const useSaveStore = create<SaveStoreState>((set) => ({
    fileHandleByPdf: {},
    isDirtyByPdf: {},
    autosaveEnabledByPdf: {},
    permissionGrantedByPdf: {},
    saveStatusByPdf: {},
    needsUserAction: {},
    lastModifiedMsByPdf: {},
    lastSavedMsByPdf: {},
    conflictByPdf: {},

    setSaveStatus: (id, status) => set(state => ({
        saveStatusByPdf: { ...state.saveStatusByPdf, [id]: status }
    })),
    setFileHandle: (id, handle) => set(state => ({
        fileHandleByPdf: { ...state.fileHandleByPdf, [id]: handle }
    })),
    setPermissionGranted: (id, granted) => set(state => ({
        permissionGrantedByPdf: { ...state.permissionGrantedByPdf, [id]: granted }
    })),
    setAutosaveEnabled: (id, enabled) => set(state => ({
        autosaveEnabledByPdf: { ...state.autosaveEnabledByPdf, [id]: enabled }
    })),
    setNeedsUserAction: (id, action) => set(state => ({
        needsUserAction: { ...state.needsUserAction, [id]: action }
    })),
    setConflict: (id, conflict) => set(state => ({
        conflictByPdf: { ...state.conflictByPdf, [id]: conflict },
        saveStatusByPdf: { ...state.saveStatusByPdf, [id]: conflict ? 'conflict' : state.saveStatusByPdf[id] }
    })),
    clearDoc: (id) => set(state => {
        const { [id]: _1, ...f } = state.fileHandleByPdf;
        const { [id]: _2, ...d } = state.isDirtyByPdf;
        const { [id]: _3, ...a } = state.autosaveEnabledByPdf;
        const { [id]: _4, ...p } = state.permissionGrantedByPdf;
        const { [id]: _5, ...s } = state.saveStatusByPdf;
        const { [id]: _6, ...n } = state.needsUserAction;
        const { [id]: _7, ...c } = state.conflictByPdf;
        return {
            fileHandleByPdf: f,
            isDirtyByPdf: d,
            autosaveEnabledByPdf: a,
            permissionGrantedByPdf: p,
            saveStatusByPdf: s,
            needsUserAction: n,
            conflictByPdf: c
        };
    }),
}));

export class SaveManager {
    static instance: SaveManager;
    private controllers = new Map<string, FileSaveController>();

    constructor() {
        if (SaveManager.instance) {
            return SaveManager.instance;
        }
        SaveManager.instance = this;
    }

    // Helper to get ID
    private getFileId(file: EditorFile): string {
        return file.kind === 'local' ? file.localFileId : file.fileId;
    }

    private getAutosaveKey(id: string) {
        return `pdf-reader:autosave:${id}`;
    }

    async registerFile(file: EditorFile, initialState?: SaveInit) {
        const id = this.getFileId(file);

        // Step 6.7: Viewer behavior (Read-Only)
        if (file.kind === 'cloud' && file.role === 'viewer') {
            console.log('[SaveManager] Skipping registration for viewer (read-only):', id);
            return;
        }

        if (this.controllers.has(id)) {
            // Already registered - safe to ignore
            console.log('[SaveManager] File already registered, skipping:', id);
            return;
        }

        let adapter: SaveAdapter;
        if (initialState?.adapter) {
            adapter = initialState.adapter;
        } else {
            if (file.kind === 'local') {
                const { localFileDB } = await import('../storage/local-file-db');
                adapter = new LocalSaveAdapter(file.localFileId, localFileDB);
            } else {
                // Cloud File
                const { CloudSaveAdapter } = await import('./cloud-save-adapter');
                // The new CloudSaveAdapter reqs: fileId, folderId, apiClient(optional?)
                // My new CloudSaveAdapter doesn't use the apiClient passed in constructor anymore, 
                // it uses direct `getClient()` inside. 
                // But I kept the constructor signature: `constructor(fileId: string, folderId: string, apiClient: RealBackendClient)`
                // Let's pass null or dummy for apiClient if it's unused, or I should have removed it.
                // I will update the code to match the constructor I wrote.

                const folderId = file.folderId || 'root'; // Fallback
                adapter = new CloudSaveAdapter(file.fileId, folderId, file.displayName);
            }
        }

        const controller = new FileSaveController(file, adapter, () => {
            this.syncState(id, controller);
        });

        this.controllers.set(id, controller);

        // Initial sync
        // Initial sync - Defer to avoid React "setState during render" error
        setTimeout(() => {
            this.syncState(id, controller);
        }, 0);

        console.log('[SaveManager] Registered file:', id);

        // Restore Autosave Preference
        const savedPref = localStorage.getItem(this.getAutosaveKey(id));
        if (savedPref === 'true' && controller.payloadProvider) {
            console.log('[SaveManager] Restoring autosave preference for:', id);
            this.enableAutosave(id);
        }
    }

    unregisterFile(file: EditorFile) {
        const id = this.getFileId(file);
        this.unregisterById(id);
    }

    unregisterById(id: string) {
        const controller = this.controllers.get(id);
        if (controller) {
            controller.disableAutosave();
            this.controllers.delete(id);

            console.log('[SaveManager] Unregistering file (scheduling store update):', id);

            // Cleanup store - defer to avoid "update while rendering" errors
            queueMicrotask(() => {
                useSaveStore.setState(state => {
                    const { [id]: _1, ...isDirtyByPdf } = state.isDirtyByPdf;
                    const { [id]: _2, ...saveStatusByPdf } = state.saveStatusByPdf;
                    const { [id]: _3, ...autosaveEnabledByPdf } = state.autosaveEnabledByPdf;
                    return { isDirtyByPdf, saveStatusByPdf, autosaveEnabledByPdf };
                });
            });
        }
    }

    // --- State Sync ---

    private syncState(id: string, controller: FileSaveController) {
        const s = controller.saveState;

        // Map Controller State to UI State
        let status: SaveStatus = 'idle';
        // 'dirty' implies idle but modified.
        // Old saveStatus was 'idle' | 'saving' | 'done' | 'error'.
        if (s === 'saving') status = 'saving';
        if (s === 'error') status = 'error';
        if (s === 'idle' || s === 'dirty') status = 'idle';

        // IMPORTANT: Defer store update to prevent "Cannot update a component 
        // while rendering a different component" React error.
        // syncState can be called during PDFViewer's effect chain, and Sidebar
        // subscribes to useSaveStore. Direct setState here would trigger Sidebar
        // re-render during PDFViewer render.
        queueMicrotask(() => {
            console.log('[SaveManager] syncState Microtask running for:', id, status);
            useSaveStore.setState(state => ({
                isDirtyByPdf: { ...state.isDirtyByPdf, [id]: s === 'dirty' || s === 'error' },
                saveStatusByPdf: { ...state.saveStatusByPdf, [id]: status },
                autosaveEnabledByPdf: { ...state.autosaveEnabledByPdf, [id]: !!controller.autosaveTimer },
            }));
        });
    }

    // --- Public API (Compat + New) ---

    markDirty(file: EditorFile | string): void {
        const id = typeof file === 'string' ? file : this.getFileId(file);
        const controller = this.controllers.get(id);
        if (controller) {
            controller.markDirty();
        }
    }

    async saveNow(
        fileOrId: EditorFile | string,
        reason: SaveReason,
        payload: AnnotationData
    ): Promise<SaveResult> {
        const id = typeof fileOrId === 'string' ? fileOrId : this.getFileId(fileOrId);
        const controller = this.controllers.get(id);
        if (!controller) {
            return { success: false, error: 'File not registered' };
        }
        return controller.saveNow(reason, payload);
    }

    // Compat method for UI
    getRegisteredDocs() {
        return Array.from(this.controllers.values()).map(c => ({
            id: c.file.kind === 'local' ? c.file.localFileId : c.file.fileId,
            name: c.file.displayName,
            kind: c.file.kind
        }));
    }

    async saveDoc(id: string, options: { forcePicker?: boolean; flatten?: boolean; download?: boolean; downloadPackage?: boolean } = {}) {
        const controller = this.controllers.get(id);
        if (!controller) return;

        if (controller.payloadProvider) {
            const payload = controller.payloadProvider();
            let reason: SaveReason = 'manual';
            if (options.downloadPackage) reason = 'download-package';
            else if (options.flatten) reason = 'flatten';
            else if (options.forcePicker) reason = 'save-as';
            else if (options.download) reason = 'export';

            await controller.saveNow(reason, payload);
        } else {
            console.error('[SaveManager] No payload provider for', id);
        }
    }

    setPayloadProvider(id: string, provider: () => AnnotationData) {
        const controller = this.controllers.get(id);
        if (controller) {
            controller.payloadProvider = provider;
        }
    }

    enableAutosave(
        fileOrId: EditorFile | string,
        getCurrentPayload?: () => AnnotationData,
        intervalSec?: number
    ): void {
        const id = typeof fileOrId === 'string' ? fileOrId : this.getFileId(fileOrId);
        const controller = this.controllers.get(id);
        if (controller) {
            // Update provider if given
            if (getCurrentPayload) controller.payloadProvider = getCurrentPayload;

            const provider = getCurrentPayload || controller.payloadProvider;
            if (!provider) {
                console.error('[SaveManager] Cannot enable autosave without payload provider');
                return;
            }

            const defaultInterval = controller.file.kind === 'local' ? AUTOSAVE_DEFAULTS.local.intervalSec : AUTOSAVE_DEFAULTS.cloud.intervalSec;
            controller.enableAutosave(intervalSec || defaultInterval, provider);

            // Persist preference
            localStorage.setItem(this.getAutosaveKey(id), 'true');
        }
    }

    disableAutosave(fileOrId: EditorFile | string): void {
        const id = typeof fileOrId === 'string' ? fileOrId : this.getFileId(fileOrId);
        const controller = this.controllers.get(id);
        if (controller) {
            controller.disableAutosave();

            // Remove preference (or set false)
            localStorage.removeItem(this.getAutosaveKey(id));
        }
    }


    async pickFileForAutosave(id: string) {
        // Map to save-as which triggers picker
        await this.saveDoc(id, { forcePicker: true });
        return { success: true };
    }

    async saveAllModified() {
        for (const controller of this.controllers.values()) {
            if (controller.saveState === 'dirty') {
                if (controller.payloadProvider) {
                    await controller.saveNow('manual', controller.payloadProvider());
                }
            }
        }
    }

    // ============================================
    // Conflict Resolution Methods
    // ============================================

    /**
     * Resolve conflict by reloading server version
     * Discards local changes and fetches latest from server
     */
    async resolveConflictWithReload(id: string, loadAnnotationsCallback: (annotations: any[]) => void): Promise<void> {
        const controller = this.controllers.get(id);
        if (!controller || controller.file.kind !== 'cloud') return;

        console.log('[SaveManager] Resolving conflict with reload for:', id);

        // Clear conflict state
        useSaveStore.getState().setConflict(id, null);

        // Load latest from server
        const { CloudSaveAdapter } = await import('./cloud-save-adapter');
        const adapter = controller.adapter as InstanceType<typeof CloudSaveAdapter>;

        // Fetch latest annotations via API
        const { annotationService } = await import('../annotation-service');
        const cloudFile = controller.file as Extract<EditorFile, { kind: 'cloud' }>;

        const annotations = await annotationService.loadAnnotations(cloudFile.fileId, cloudFile.folderId);

        if (annotations) {
            // Update editor state
            loadAnnotationsCallback(annotations);

            // Update base hash in adapter (compute hash of loaded data)
            const json = JSON.stringify({ objects: annotations });
            const msgBuffer = new TextEncoder().encode(json);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const newHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            adapter.setBaseHash(newHash);

            // Clear dirty state
            controller.markClean();

            // Resume autosave
            if (controller.payloadProvider) {
                controller.enableAutosave(60, controller.payloadProvider);
            }
        }
    }

    /**
     * Resolve conflict by force-overwriting server version
     */
    async resolveConflictWithOverwrite(id: string): Promise<void> {
        const controller = this.controllers.get(id);
        if (!controller || controller.file.kind !== 'cloud') return;
        if (!controller.payloadProvider) return;

        console.log('[SaveManager] Resolving conflict with overwrite for:', id);

        // Clear conflict state
        useSaveStore.getState().setConflict(id, null);

        const { CloudSaveAdapter } = await import('./cloud-save-adapter');
        const adapter = controller.adapter as InstanceType<typeof CloudSaveAdapter>;

        const payload = controller.payloadProvider();
        await adapter.forceSave(payload);

        // Clear dirty state
        controller.markClean();

        // Resume autosave
        if (controller.payloadProvider) {
            controller.enableAutosave(60, controller.payloadProvider);
        }
    }

    /**
     * Resolve conflict by saving as a copy
     * Returns the new file ID for the caller to switch context
     */
    async resolveConflictWithCopy(id: string): Promise<{ newFileId: string; newDisplayName: string } | null> {
        const controller = this.controllers.get(id);
        if (!controller || controller.file.kind !== 'cloud') return null;
        if (!controller.payloadProvider) return null;

        console.log('[SaveManager] Resolving conflict with copy for:', id);

        // Clear conflict state
        useSaveStore.getState().setConflict(id, null);

        const { CloudSaveAdapter } = await import('./cloud-save-adapter');
        const adapter = controller.adapter as InstanceType<typeof CloudSaveAdapter>;

        const payload = controller.payloadProvider();
        const result = await adapter.saveCopy(payload);

        console.log('[SaveManager] Created copy:', result);

        return result;
    }
}

export const saveManager = new SaveManager();
