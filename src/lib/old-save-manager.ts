import { create } from 'zustand';

// ============================================
// Types
// ============================================

export type SaveStatus = 'idle' | 'saving' | 'done' | 'error';

export interface DocumentSaver {
    id: string;
    name: string;
    getBlob: (options?: { flatten?: boolean }) => Promise<Blob>;
    onSaveSuccess?: (handle: FileSystemFileHandle) => void;
}

export interface SaveStoreState {
    fileHandleByPdf: Record<string, FileSystemFileHandle | null>;
    isDirtyByPdf: Record<string, boolean>;
    autosaveEnabledByPdf: Record<string, boolean>;
    permissionGrantedByPdf: Record<string, boolean>;
    saveStatusByPdf: Record<string, SaveStatus>;
    needsUserAction: Record<string, { reason: 'no-handle' | 'no-permission' | 'error' | 'timeout'; message?: string; firstSeen?: number } | null>;
    lastModifiedMsByPdf: Record<string, number>;
    lastSavedMsByPdf: Record<string, number>;

    setFileHandle: (pdfId: string, handle: FileSystemFileHandle | null) => void;
    setDirty: (pdfId: string, dirty: boolean) => void;
    setAutosaveEnabled: (pdfId: string, enabled: boolean) => void;
    setPermissionGranted: (pdfId: string, granted: boolean) => void;
    setSaveStatus: (pdfId: string, status: SaveStatus) => void;
    setNeedsUserAction: (pdfId: string, action: { reason: 'no-handle' | 'no-permission' | 'error' | 'timeout'; message?: string; firstSeen?: number } | null) => void;
    setLastModified: (pdfId: string, ms: number) => void;
    setLastSaved: (pdfId: string, ms: number) => void;
    clearDoc: (pdfId: string) => void;
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

    setFileHandle: (pdfId, handle) => set((state) => ({
        fileHandleByPdf: { ...state.fileHandleByPdf, [pdfId]: handle }
    })),
    setDirty: (pdfId, dirty) => set((state) => ({
        isDirtyByPdf: { ...state.isDirtyByPdf, [pdfId]: dirty }
    })),
    setAutosaveEnabled: (pdfId, enabled) => set((state) => ({
        autosaveEnabledByPdf: { ...state.autosaveEnabledByPdf, [pdfId]: enabled }
    })),
    setPermissionGranted: (pdfId, granted) => set((state) => ({
        permissionGrantedByPdf: { ...state.permissionGrantedByPdf, [pdfId]: granted }
    })),
    setSaveStatus: (pdfId, status) => set((state) => ({
        saveStatusByPdf: { ...state.saveStatusByPdf, [pdfId]: status }
    })),
    setNeedsUserAction: (pdfId, action) => set((state) => ({
        needsUserAction: { ...state.needsUserAction, [pdfId]: action }
    })),
    setLastModified: (pdfId, ms) => set((state) => ({
        lastModifiedMsByPdf: { ...state.lastModifiedMsByPdf, [pdfId]: ms }
    })),
    setLastSaved: (pdfId, ms) => set((state) => ({
        lastSavedMsByPdf: { ...state.lastSavedMsByPdf, [pdfId]: ms }
    })),
    clearDoc: (pdfId) => set((state) => {
        const { [pdfId]: _h, ...fileHandleByPdf } = state.fileHandleByPdf;
        const { [pdfId]: _d, ...isDirtyByPdf } = state.isDirtyByPdf;
        const { [pdfId]: _a, ...autosaveEnabledByPdf } = state.autosaveEnabledByPdf;
        const { [pdfId]: _p, ...permissionGrantedByPdf } = state.permissionGrantedByPdf;
        const { [pdfId]: _s, ...saveStatusByPdf } = state.saveStatusByPdf;
        const { [pdfId]: _n, ...needsUserAction } = state.needsUserAction;
        const { [pdfId]: _m, ...lastModifiedMsByPdf } = state.lastModifiedMsByPdf;
        const { [pdfId]: _k, ...lastSavedMsByPdf } = state.lastSavedMsByPdf;
        return { fileHandleByPdf, isDirtyByPdf, autosaveEnabledByPdf, permissionGrantedByPdf, saveStatusByPdf, needsUserAction, lastModifiedMsByPdf, lastSavedMsByPdf };
    }),
}));

// ============================================
// SaveQueue with proper retry handling
// ============================================

interface PendingJob {
    pdfId: string;
    modTimestamp: number;
    enqueuedAt: number;
    attemptCount: number;
    nextRetryAt?: number; // For delayed retries
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30_000; // 30 seconds between retries
const NO_HANDLE_RETRY_DELAY_MS = 2 * 60_000; // 2 minutes for no-handle cases

class SaveQueue {
    private queue: PendingJob[] = [];
    private processing = false;
    private saveInProgress = new Set<string>();
    private pendingJobByPdf = new Map<string, PendingJob>();

    enqueue(pdfId: string, modTimestamp: number, resetAttempts = false) {
        const now = Date.now();
        const existing = this.pendingJobByPdf.get(pdfId);

        if (existing) {
            existing.modTimestamp = modTimestamp;
            if (resetAttempts) existing.attemptCount = 0;
            console.log('[SaveQueue] Updated job:', pdfId);
        } else {
            const job: PendingJob = { pdfId, modTimestamp, enqueuedAt: now, attemptCount: 0 };
            this.pendingJobByPdf.set(pdfId, job);
            this.queue.push(job);
            console.log('[SaveQueue] Enqueued:', pdfId);
        }

        this.processNext();
    }

    requeueWithDelay(job: PendingJob, delayMs: number, incrementAttempt: boolean) {
        job.nextRetryAt = Date.now() + delayMs;
        if (incrementAttempt) job.attemptCount++;

        // Remove from queue if exists, then re-add
        this.queue = this.queue.filter(j => j.pdfId !== job.pdfId);
        this.pendingJobByPdf.set(job.pdfId, job);
        this.queue.push(job);

        console.log('[SaveQueue] Requeued with delay:', job.pdfId, delayMs, 'attempts:', job.attemptCount);

        // Schedule processing after delay
        setTimeout(() => this.processNext(), delayMs);
    }

    private async processNext() {
        if (this.processing) return;

        while (this.queue.length > 0) {
            this.processing = true;

            // Find next job that's ready (not delayed)
            const now = Date.now();
            const readyJobIndex = this.queue.findIndex(j => !j.nextRetryAt || j.nextRetryAt <= now);

            if (readyJobIndex === -1) {
                // All jobs are delayed
                this.processing = false;
                return;
            }

            const job = this.queue.splice(readyJobIndex, 1)[0];
            this.pendingJobByPdf.delete(job.pdfId);

            if (this.saveInProgress.has(job.pdfId)) continue;
            this.saveInProgress.add(job.pdfId);

            console.log('[SaveQueue] Processing:', job.pdfId, 'attempt:', job.attemptCount + 1);

            try {
                const result = await saveManager.executeSave(job.pdfId, job.modTimestamp);

                if (result.error) {
                    if (result.error === 'no-handle' || result.error === 'no-permission') {
                        // User-resolution required - don't count as attempt
                        console.warn('[SaveQueue] Needs user action:', job.pdfId, result.error);
                        useSaveStore.getState().setNeedsUserAction(job.pdfId, {
                            reason: result.error,
                            firstSeen: Date.now()
                        });
                        // Requeue with long delay, don't increment attempt
                        this.requeueWithDelay(job, NO_HANDLE_RETRY_DELAY_MS, false);
                    } else if (result.error === 'locked') {
                        // Locked file (NotReadableError) - retry sooner, count attempt but be lenient
                        console.warn('[SaveQueue] File locked, retrying:', job.pdfId);
                        this.requeueWithDelay(job, 2000, true); // Retry in 2s
                    } else {
                        // Transient error - retry with backoff
                        if (job.attemptCount < MAX_RETRIES) {
                            console.warn('[SaveQueue] Retryable error:', job.pdfId, result.error);
                            this.requeueWithDelay(job, RETRY_DELAY_MS * (job.attemptCount + 1), true);
                        } else {
                            console.error('[SaveQueue] Max retries reached:', job.pdfId);
                            useSaveStore.getState().setSaveStatus(job.pdfId, 'error');
                            useSaveStore.getState().setNeedsUserAction(job.pdfId, {
                                reason: 'error',
                                message: 'Save failed after multiple attempts.'
                            });
                        }
                    }
                }
                // Success case is handled inside executeSave
            } catch (err: any) {
                console.error('[SaveQueue] Unexpected error:', job.pdfId, err);
            } finally {
                this.saveInProgress.delete(job.pdfId);
            }
        }
        this.processing = false;
    }
}

// ============================================
// SaveManager
// ============================================

class SaveManager {
    private registry = new Map<string, DocumentSaver>();
    private refCountByPdf = new Map<string, number>();
    private queue = new SaveQueue();
    private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

    // ----------------
    // Registration
    // ----------------

    registerDoc(doc: DocumentSaver) {
        const currentCount = this.refCountByPdf.get(doc.id) || 0;
        this.refCountByPdf.set(doc.id, currentCount + 1);

        if (!this.registry.has(doc.id)) {
            this.registry.set(doc.id, doc);
            console.log('[SaveManager] Registered:', doc.id);
        } else {
            this.registry.set(doc.id, doc);
        }
    }

    unregisterDoc(pdfId: string) {
        const currentCount = this.refCountByPdf.get(pdfId);
        if (!currentCount) return;

        if (currentCount > 1) {
            this.refCountByPdf.set(pdfId, currentCount - 1);
        } else {
            this.refCountByPdf.delete(pdfId);
            this.registry.delete(pdfId);
            this.clearDebounce(pdfId);
            console.log('[SaveManager] Unregistered:', pdfId);
        }
    }

    getDoc(pdfId: string) { return this.registry.get(pdfId); }

    getRegisteredDocs() {
        return Array.from(this.registry.values()).map(d => ({ id: d.id, name: d.name }));
    }

    // ----------------
    // Dirty & Debounce
    // ----------------

    markDirty(pdfId: string) {
        const store = useSaveStore.getState();
        const now = Date.now();

        store.setDirty(pdfId, true);
        store.setLastModified(pdfId, now);

        if (store.autosaveEnabledByPdf[pdfId]) {
            this.resetDebounce(pdfId);
        }
    }

    private resetDebounce(pdfId: string) {
        this.clearDebounce(pdfId);

        const DEBOUNCE_MS = 10_000; // 10s for testing
        console.log('[SaveManager] Debounce started:', pdfId);

        const timer = setTimeout(() => {
            this.debounceTimers.delete(pdfId);
            const store = useSaveStore.getState();

            if (store.isDirtyByPdf[pdfId]) {
                const modTs = store.lastModifiedMsByPdf[pdfId] || Date.now();
                console.log('[SaveManager] Debounce fired, enqueueing:', pdfId);
                this.queue.enqueue(pdfId, modTs);
            }
        }, DEBOUNCE_MS);

        this.debounceTimers.set(pdfId, timer);
    }

    private clearDebounce(pdfId: string) {
        const existing = this.debounceTimers.get(pdfId);
        if (existing) {
            clearTimeout(existing);
            this.debounceTimers.delete(pdfId);
        }
    }

    // ----------------
    // Autosave Control
    // ----------------

    async enableAutosave(pdfId: string): Promise<{ success: boolean; needsPicker?: boolean }> {
        const store = useSaveStore.getState();
        const handle = store.fileHandleByPdf[pdfId];

        if (handle) {
            try {
                const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
                if (perm === 'granted') {
                    store.setPermissionGranted(pdfId, true);
                    store.setAutosaveEnabled(pdfId, true);
                    store.setNeedsUserAction(pdfId, null);
                    if (store.isDirtyByPdf[pdfId]) this.markDirty(pdfId);
                    return { success: true };
                }

                const newPerm = await (handle as any).requestPermission({ mode: 'readwrite' });
                if (newPerm === 'granted') {
                    store.setPermissionGranted(pdfId, true);
                    store.setAutosaveEnabled(pdfId, true);
                    store.setNeedsUserAction(pdfId, null);
                    if (store.isDirtyByPdf[pdfId]) this.markDirty(pdfId);
                    return { success: true };
                }

                store.setNeedsUserAction(pdfId, { reason: 'no-permission' });
                return { success: false };
            } catch {
                return { success: false };
            }
        }
        return { success: false, needsPicker: true };
    }

    async pickFileForAutosave(pdfId: string): Promise<{ success: boolean }> {
        const store = useSaveStore.getState();
        const doc = this.registry.get(pdfId);
        if (!doc) return { success: false };

        if (!('showSaveFilePicker' in window)) {
            store.setAutosaveEnabled(pdfId, true);
            return { success: true };
        }

        try {
            const handle = await (window as any).showSaveFilePicker({
                suggestedName: doc.name.endsWith('.pdf') ? doc.name : `${doc.name}.pdf`,
                types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
            });

            const perm = await (handle as any).requestPermission({ mode: 'readwrite' });

            store.setFileHandle(pdfId, handle);
            store.setPermissionGranted(pdfId, perm === 'granted');

            if (perm === 'granted') {
                store.setAutosaveEnabled(pdfId, true);
                store.setNeedsUserAction(pdfId, null);

                // Reset any pending job attempts and trigger immediate save if dirty
                if (store.isDirtyByPdf[pdfId]) {
                    this.queue.enqueue(pdfId, store.lastModifiedMsByPdf[pdfId] || Date.now(), true);
                }
                return { success: true };
            }
            return { success: false };
        } catch (err: any) {
            if (err.name === 'AbortError') return { success: false };
            return { success: false };
        }
    }

    disableAutosave(pdfId: string) {
        useSaveStore.getState().setAutosaveEnabled(pdfId, false);
        this.clearDebounce(pdfId);
    }

    // ----------------
    // Execute Save
    // ----------------

    async executeSave(pdfId: string, modTimestamp: number, options: { flatten?: boolean } = {}): Promise<{ success?: boolean; error?: string }> {
        const store = useSaveStore.getState();

        // Skip if already saved (only if NOT flattening/exporting)
        // Export is always a forced action
        const lastSaved = store.lastSavedMsByPdf[pdfId] || 0;
        if (!options.flatten && lastSaved >= modTimestamp) {
            console.log('[SaveManager] Already saved:', pdfId);
            return { success: true };
        }

        const doc = this.registry.get(pdfId);
        if (!doc) return { error: 'not-registered' };

        const handle = store.fileHandleByPdf[pdfId];
        if (!handle) {
            return { error: 'no-handle' };
        }

        // Pre-validate permission
        try {
            const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted') {
                store.setPermissionGranted(pdfId, false);
                return { error: 'no-permission' };
            }
        } catch {
            return { error: 'no-permission' };
        }

        store.setSaveStatus(pdfId, 'saving');
        console.log('[SaveManager] Saving:', pdfId, options.flatten ? '(Flattened)' : '(Standard)');

        try {
            // Pass options to getBlob
            const blob = await doc.getBlob(options);
            // Internal retry loop for createWritable (handles transient OS/OneDrive locks)
            let writable;
            let lastError;

            for (let i = 0; i < 3; i++) {
                try {
                    writable = await handle.createWritable({ keepExistingData: false });
                    break;
                } catch (e: any) {
                    lastError = e;
                    if (e.name === 'NotReadableError' || e.name === 'NoModificationAllowedError') {
                        // Wait briefly before internal retry
                        await new Promise(r => setTimeout(r, 500 * (i + 1)));
                        continue;
                    }
                    throw e; // Throw other errors immediately
                }
            }

            if (!writable && lastError) throw lastError;
            if (!writable) throw new Error('Failed to create writable stream');

            await writable.write(blob);
            await writable.close();

            const now = Date.now();
            store.setLastSaved(pdfId, now);
            store.setDirty(pdfId, false);
            store.setSaveStatus(pdfId, 'done');
            store.setNeedsUserAction(pdfId, null);
            // IMPORTANT: Do NOT clear fileHandle here!

            console.log('[SaveManager] Save success:', pdfId);

            // Notify document that save succeeded
            if (doc.onSaveSuccess) {
                try {
                    doc.onSaveSuccess(handle);
                } catch (e) {
                    console.error('[SaveManager] Error in onSaveSuccess:', e);
                }
            }

            setTimeout(() => {
                if (useSaveStore.getState().saveStatusByPdf[pdfId] === 'done')
                    useSaveStore.getState().setSaveStatus(pdfId, 'idle');
            }, 2000);

            // Check for new edits during save
            const currentMod = useSaveStore.getState().lastModifiedMsByPdf[pdfId] || 0;
            if (currentMod > now && useSaveStore.getState().autosaveEnabledByPdf[pdfId]) {
                console.log('[SaveManager] New edits during save, re-enqueueing:', pdfId);
                this.queue.enqueue(pdfId, currentMod);
            }

            return { success: true };
        } catch (err: any) {
            console.error('[SaveManager] Save error:', pdfId, err);
            store.setSaveStatus(pdfId, 'error');

            const errName = err.name || '';
            const errMsg = err.message || '';

            if (errName === 'NotAllowedError' || errName === 'SecurityError') {
                store.setPermissionGranted(pdfId, false);
                return { error: 'no-permission' };
            }
            if (errName === 'NotReadableError' || errName.includes('NotReadable') || errMsg.includes('lock') || errMsg.includes('busy')) {
                // File system lock contention
                return { error: 'locked' };
            }
            if (errName === 'InvalidStateError' || errMsg.includes('not valid')) {
                store.setFileHandle(pdfId, null);
                store.setPermissionGranted(pdfId, false);
                return { error: 'no-handle' };
            }
            return { error: 'io-error' };
        }
    }

    // ----------------
    // Manual Save
    // ----------------

    async saveDoc(pdfId: string, options: { forcePicker?: boolean; flatten?: boolean } = {}) {
        const store = useSaveStore.getState();
        const now = Date.now();
        store.setLastModified(pdfId, now);

        if (options.forcePicker) {
            // Note: If flattening, we might want to prompt for a new filename always?
            // Yes, Save As logic is good.
            await this.pickFileForAutosave(pdfId);
        }

        // We need to pass the 'flatten' option to executeSave, but currently SaveQueue only stores timestamps.
        // We can either:
        // A) Add 'options' to PendingJob
        // B) Just trigger it directly for manual saves?
        // C) Hack: If flattening, bypass queue? Flattening is a "Export" action, usually immediate.

        if (options.flatten) {
            // Bypass queue for immediate export
            const doc = this.registry.get(pdfId);
            if (doc) {
                // For export, we might not want to save to the 'current handle' if it overwrites the editable one?
                // The UI flow for 'Export Flattened' forces a picker (Save As).
                // So the file handle will be the NEW file.
                // This is correct.
                await this.executeSave(pdfId, now, { flatten: true });
            }
            return;
        }

        this.queue.enqueue(pdfId, now, true);
    }

    async saveAllModified() {
        const store = useSaveStore.getState();
        const dirtyIds = Object.keys(store.isDirtyByPdf).filter(id => store.isDirtyByPdf[id]);
        const now = Date.now();

        for (const id of dirtyIds) {
            store.setLastModified(id, now);
            this.queue.enqueue(id, now);
        }
    }

    downloadBlob(blob: Blob, filename: string) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

export const saveManager = new SaveManager();
