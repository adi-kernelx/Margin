
import { create } from 'zustand';
import { type EditorFile, type AnnotationData, AUTOSAVE_DEFAULTS } from '../../types/editor-types';
import { type SaveReason, type SaveResult, type SaveInit, type SaveAdapter } from './types';
import { FileSaveController } from './file-save-controller';
import { LocalSaveAdapter } from './local-save-adapter';

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

    // Actions
    setSaveStatus: (id: string, status: SaveStatus) => void;
    setFileHandle: (id: string, handle: FileSystemFileHandle) => void;
    setPermissionGranted: (id: string, granted: boolean) => void;
    setAutosaveEnabled: (id: string, enabled: boolean) => void;
    setNeedsUserAction: (id: string, action: any) => void;
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
    clearDoc: (id) => set(state => {
        const { [id]: _1, ...f } = state.fileHandleByPdf;
        const { [id]: _2, ...d } = state.isDirtyByPdf;
        const { [id]: _3, ...a } = state.autosaveEnabledByPdf;
        const { [id]: _4, ...p } = state.permissionGrantedByPdf;
        const { [id]: _5, ...s } = state.saveStatusByPdf;
        const { [id]: _6, ...n } = state.needsUserAction;
        return {
            fileHandleByPdf: f,
            isDirtyByPdf: d,
            autosaveEnabledByPdf: a,
            permissionGrantedByPdf: p,
            saveStatusByPdf: s,
            needsUserAction: n,
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
        return file.localFileId;
    }

    private getAutosaveKey(id: string) {
        return `pdf-reader:autosave:${id}`;
    }

    async registerFile(file: EditorFile, initialState?: SaveInit) {
        const id = this.getFileId(file);

        if (this.controllers.has(id)) {
            // Already registered - safe to ignore
            console.log('[SaveManager] File already registered, skipping:', id);
            return;
        }

        let adapter: SaveAdapter;
        if (initialState?.adapter) {
            adapter = initialState.adapter;
        } else {
            const { localFileDB } = await import('../storage/local-file-db');
            adapter = new LocalSaveAdapter(file.localFileId, localFileDB);
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
            id: c.file.localFileId,
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

    setPdfProvider(id: string, provider: () => Promise<Uint8Array>) {
        const controller = this.controllers.get(id);
        if (controller) controller.pdfProvider = provider;
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

}

export const saveManager = new SaveManager();
