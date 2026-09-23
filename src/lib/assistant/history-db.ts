// Assistant chat history, stored locally in its own IndexedDB database so its
// schema versions independently of the library and annotation stores.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Conversation } from '@/core/assistant/conversation';

interface AssistantDB extends DBSchema {
    conversations: {
        key: string;
        value: Conversation;
        indexes: { byDoc: string; byUpdated: number };
    };
}

const DB_NAME = 'margin-assistant';
const MAX_PER_DOCUMENT = 50;

let dbPromise: Promise<IDBPDatabase<AssistantDB>> | null = null;

function db() {
    dbPromise ??= openDB<AssistantDB>(DB_NAME, 1, {
        upgrade(database) {
            const store = database.createObjectStore('conversations', { keyPath: 'id' });
            store.createIndex('byDoc', 'docId');
            store.createIndex('byUpdated', 'updatedAt');
        },
    });
    return dbPromise;
}

/** Most recent first. `docId` '' lists workspace-wide conversations. */
export async function listConversations(docId: string): Promise<Conversation[]> {
    const all = await (await db()).getAllFromIndex('conversations', 'byDoc', docId);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveConversation(conversation: Conversation): Promise<void> {
    const database = await db();
    await database.put('conversations', conversation);
    // Keep history bounded per document; the oldest conversations go first.
    const siblings = await listConversations(conversation.docId);
    for (const stale of siblings.slice(MAX_PER_DOCUMENT)) await database.delete('conversations', stale.id);
}

export async function deleteConversation(id: string): Promise<void> {
    await (await db()).delete('conversations', id);
}
