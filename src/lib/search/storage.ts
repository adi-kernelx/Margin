import { openDB, type DBSchema } from 'idb';
import type { IndexedSearchPage } from '@/core/search/index';

interface SearchDB extends DBSchema {
    pages: {
        key: string;
        value: IndexedSearchPage & { id: string; documentRevision?: string };
        indexes: { byFingerprint: string };
    };
}

const database = openDB<SearchDB>('margin-search-index', 1, {
    upgrade(db) {
        const pages = db.createObjectStore('pages', { keyPath: 'id' });
        pages.createIndex('byFingerprint', 'pdfFingerprint');
    },
});

export const searchIndexStorage = {
    async load(pdfFingerprint: string, docId: string, documentRevision: string): Promise<IndexedSearchPage[]> {
        const rows = await (await database).getAllFromIndex('pages', 'byFingerprint', pdfFingerprint);
        return rows.filter(row => row.documentRevision === documentRevision)
            .sort((a, b) => a.page - b.page).map(row => ({
            docId,
            pdfFingerprint: row.pdfFingerprint,
            page: row.page,
            text: row.text,
            spans: row.spans,
        }));
    },

    async replace(pdfFingerprint: string, documentRevision: string, pages: IndexedSearchPage[]): Promise<void> {
        const db = await database;
        const transaction = db.transaction('pages', 'readwrite');
        const existing = await transaction.store.index('byFingerprint').getAllKeys(pdfFingerprint);
        await Promise.all(existing.map(key => transaction.store.delete(key)));
        await Promise.all(pages.map(page => transaction.store.put({
            ...page,
            documentRevision,
            id: `${pdfFingerprint}:${documentRevision}:${page.page}`,
        })));
        await transaction.done;
    },
};
