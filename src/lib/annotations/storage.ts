import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Annotation } from './models';

interface PDReaderDB extends DBSchema {
    sidecars: {
        key: string;
        value: {
            id: string; // stableId
            annotations: Annotation[];
            updatedAt: number;
        };
    };
    annotations: {
        key: string;
        value: Annotation;
    };
}

class AnnotationStorage {
    private dbPromise: Promise<IDBPDatabase<PDReaderDB>>;

    constructor() {
        this.dbPromise = openDB<PDReaderDB>('pdf-reader-db', 2, {
            upgrade(db) {
                if (!db.objectStoreNames.contains('sidecars')) {
                    db.createObjectStore('sidecars', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('annotations')) {
                    db.createObjectStore('annotations', { keyPath: 'id' });
                }
            },
        });
    }

    async saveSidecar(stableId: string, annotations: Annotation[]): Promise<void> {
        const db = await this.dbPromise;
        await db.put('sidecars', {
            id: stableId,
            annotations,
            updatedAt: Date.now(),
        });
    }

    async loadSidecar(stableId: string): Promise<Annotation[] | null> {
        const db = await this.dbPromise;
        const entry = await db.get('sidecars', stableId);
        return entry ? entry.annotations : null;
    }

    async copySidecar(oldStableId: string, newStableId: string): Promise<void> {
        const annotations = await this.loadSidecar(oldStableId);
        if (annotations) {
            await this.saveSidecar(newStableId, annotations);
        }
    }

    async deleteSidecar(stableId: string): Promise<void> {
        const db = await this.dbPromise;
        await db.delete('sidecars', stableId);
    }

    // Deprecated methods kept for interface compatibility
    async saveAnnotation(_annotation: Annotation, _fileId?: string): Promise<void> {
        // No-op: Sidecar persistence is handled at document level
        // Ideally we would map _fileId to stableId and update the sidecar here for Undo/Redo support.
    }

    async deleteAnnotation(_id: string, _fileId?: string): Promise<void> {
        // No-op
    }

    async getAnnotationsByFile(_fileId: string): Promise<Annotation[]> {
        return [];
    }

    async saveOperation(_op: any, _docId?: string): Promise<void> { }

    async getOperationsByFile(_fileId: string, _limit?: number): Promise<any[]> { return []; }

    async saveAnnotationsBatch(_annotations: Annotation[], _fileId?: string): Promise<void> { }
}

export const annotationStorage = new AnnotationStorage();
