import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { KnowledgeBundle } from '@/core/knowledge/okf';

// Knowledge bundles live in their own database so their schema versions
// independently of the library and annotation stores.
interface KnowledgeDB extends DBSchema {
    bundles: {
        key: string;
        value: KnowledgeBundle;
    };
}

let dbPromise: Promise<IDBPDatabase<KnowledgeDB>> | null = null;

function db() {
    dbPromise ??= openDB<KnowledgeDB>('margin-knowledge', 1, {
        upgrade(database) {
            if (!database.objectStoreNames.contains('bundles')) {
                database.createObjectStore('bundles', { keyPath: 'documentId' });
            }
        },
    });
    return dbPromise;
}

export async function loadBundle(documentId: string): Promise<KnowledgeBundle | undefined> {
    return (await db()).get('bundles', documentId);
}

export async function saveBundle(bundle: KnowledgeBundle): Promise<void> {
    await (await db()).put('bundles', bundle);
}

export async function deleteBundle(documentId: string): Promise<void> {
    await (await db()).delete('bundles', documentId);
}
