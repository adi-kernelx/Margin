import { openDB, type DBSchema } from 'idb';
import type { PageDocument } from '@/core/pages/models';

interface PageWorkspaceDB extends DBSchema {
    documents: {
        key: string;
        value: { id: string; document: PageDocument; updatedAt: number };
    };
    sources: {
        key: string;
        value: { id: string; bytes: ArrayBuffer };
    };
}

const database = openDB<PageWorkspaceDB>('margin-page-workspaces', 1, {
    upgrade(db) {
        db.createObjectStore('documents', { keyPath: 'id' });
        db.createObjectStore('sources', { keyPath: 'id' });
    },
});

const sourceKey = (documentId: string, sourceId: string) => `${documentId}:${sourceId}`;

export const pageWorkspaceStorage = {
    async loadDocument(documentId: string): Promise<PageDocument | null> {
        const value = await (await database).get('documents', documentId);
        return value?.document ?? null;
    },

    async saveDocument(documentId: string, document: PageDocument): Promise<void> {
        await (await database).put('documents', { id: documentId, document, updatedAt: Date.now() });
    },

    async loadSource(documentId: string, sourceId: string): Promise<Uint8Array | null> {
        const value = await (await database).get('sources', sourceKey(documentId, sourceId));
        return value ? new Uint8Array(value.bytes) : null;
    },

    async saveSource(documentId: string, sourceId: string, bytes: Uint8Array): Promise<void> {
        const copy = bytes.slice().buffer;
        await (await database).put('sources', { id: sourceKey(documentId, sourceId), bytes: copy });
    },
};

