import type { Annotation } from './models';
import { annotationStorage } from './storage';

/**
 * Autosave manager that debounces IndexedDB writes
 * Prevents UI blocking during drawing by batching writes
 */
class AutosaveManager {
    private pendingChanges = new Set<string>(); // annotation IDs
    private saveTimeout?: number;
    private fileId: string;
    private annotationsCache = new Map<string, Annotation>();

    constructor(fileId: string) {
        this.fileId = fileId;
    }

    /**
     * Mark an annotation as dirty (needs saving)
     */
    markDirty(annotation: Annotation): void {
        this.annotationsCache.set(annotation.id, annotation);
        this.pendingChanges.add(annotation.id);
        this.scheduleSave();
    }

    /**
     * Mark an annotation for deletion
     */
    markDeleted(id: string): void {
        this.pendingChanges.add(id);
        this.annotationsCache.delete(id);
        this.scheduleSave();
    }

    /**
     * Schedule a debounced save
     */
    private scheduleSave(): void {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = window.setTimeout(() => {
            this.flush();
        }, 500); // 500ms debounce
    }

    /**
     * Immediately save all pending changes
     */
    async flush(): Promise<void> {
        if (this.pendingChanges.size === 0) return;

        const ids = Array.from(this.pendingChanges);
        const annotationsToSave: Annotation[] = [];

        // Collect annotations to save
        for (const id of ids) {
            const annotation = this.annotationsCache.get(id);
            if (annotation) {
                annotationsToSave.push(annotation);
            }
        }

        // Batch save
        if (annotationsToSave.length > 0) {
            await annotationStorage.saveAnnotationsBatch(annotationsToSave, this.fileId);
        }

        // Handle deletions
        const deletions = ids.filter(id => !this.annotationsCache.has(id));
        for (const id of deletions) {
            await annotationStorage.deleteAnnotation(id);
        }

        // Clear pending changes
        this.pendingChanges.clear();
    }

    /**
     * Force immediate save (e.g., on pointerup)
     */
    async saveImmediate(annotation: Annotation): Promise<void> {
        // Clear any pending debounced save for this annotation
        this.pendingChanges.delete(annotation.id);

        // Save immediately
        await annotationStorage.saveAnnotation(annotation, this.fileId);
        this.annotationsCache.set(annotation.id, annotation);
    }

    /**
     * Clean up
     */
    destroy(): void {
        clearTimeout(this.saveTimeout);
        this.flush(); // Save any remaining changes
        this.pendingChanges.clear();
        this.annotationsCache.clear();
    }
}

// Singleton per fileId
const managers = new Map<string, AutosaveManager>();

export function getAutosaveManager(fileId: string): AutosaveManager {
    if (!managers.has(fileId)) {
        managers.set(fileId, new AutosaveManager(fileId));
    }
    return managers.get(fileId)!;
}

export function destroyAutosaveManager(fileId: string): void {
    const manager = managers.get(fileId);
    if (manager) {
        manager.destroy();
        managers.delete(fileId);
    }
}


