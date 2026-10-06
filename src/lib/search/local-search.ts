import {
    matchBounds,
    searchKeywordPages,
    type IndexedSearchPage,
    type IndexedTextSpan,
} from '@/core/search/index';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export type SearchSpan = {
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    char_start?: number;
    char_end?: number;
};

export type SearchResult = {
    docId: string;
    pdfFingerprint?: string;
    page: number;
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    spans?: SearchSpan[];
};

interface RegisteredDocument {
    generation: number;
    docId: string;
    pdfFingerprint: string;
    documentRevision: string;
    pdfDoc: PDFDocumentProxy;
    pages: IndexedSearchPage[] | null;
    ready: Promise<void>;
}

export interface SearchRegistrationState {
    generation: number;
    documentRevision: string;
    pageCount: number;
    indexedPageCount: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

async function extractNativePage(document: RegisteredDocument, pageNumber: number): Promise<IndexedSearchPage> {
    const page = await document.pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const spans: IndexedTextSpan[] = [];
    let text = '';

    for (const item of content.items) {
        if (!('str' in item) || !item.str) continue;
        const clean = item.str.replace(/\s+/g, ' ').trim();
        if (!clean) continue;

        const start = text.length ? text.length + 1 : 0;
        text += `${text ? ' ' : ''}${clean}`;
        const x = item.transform[4] ?? 0;
        const y = item.transform[5] ?? 0;
        const width = item.width ?? 0;
        const height = item.height ?? Math.abs(item.transform[3] ?? 12);
        spans.push({
            text: clean,
            start,
            end: start + clean.length,
            bbox: {
                x0: clamp(x / viewport.width),
                y0: clamp((viewport.height - y - height) / viewport.height),
                x1: clamp((x + width) / viewport.width),
                y1: clamp((viewport.height - y + height * 0.2) / viewport.height),
            },
        });
    }

    return {
        docId: document.docId,
        pdfFingerprint: document.pdfFingerprint,
        page: pageNumber,
        text,
        spans,
    };
}

export class LocalSearchRegistry {
    private documents = new Map<string, RegisteredDocument>();
    private generations = new Map<string, number>();

    register(
        docId: string,
        pdfFingerprint: string,
        documentRevision: string,
        pdfDoc: PDFDocumentProxy,
    ): () => void {
        const generation = (this.generations.get(docId) ?? 0) + 1;
        this.generations.set(docId, generation);
        const document: RegisteredDocument = {
            generation,
            docId,
            pdfFingerprint,
            documentRevision,
            pdfDoc,
            pages: null,
            ready: Promise.resolve(),
        };
        this.documents.set(docId, document);
        document.ready = this.extractDocument(document);
        return () => this.unregister(docId, generation);
    }

    unregister(docId: string, generation?: number) {
        const current = this.documents.get(docId);
        if (generation !== undefined && current?.generation !== generation) return;
        this.documents.delete(docId);
        this.generations.set(docId, (this.generations.get(docId) ?? 0) + 1);
    }

    private async extractDocument(document: RegisteredDocument) {
        const pages = new Array<IndexedSearchPage>(document.pdfDoc.numPages);
        let nextPage = 1;
        const workerCount = Math.min(6, document.pdfDoc.numPages);
        await Promise.all(Array.from({ length: workerCount }, async () => {
            while (nextPage <= document.pdfDoc.numPages) {
                const pageNumber = nextPage++;
                pages[pageNumber - 1] = await extractNativePage(document, pageNumber);
            }
        }));
        if (this.documents.get(document.docId) !== document) return;
        document.pages = pages;
    }

    async waitUntilReady(docId: string): Promise<void> {
        await this.documents.get(docId)?.ready;
    }

    getRegistrationState(docId: string): SearchRegistrationState | null {
        const document = this.documents.get(docId);
        return document ? {
            generation: document.generation,
            documentRevision: document.documentRevision,
            pageCount: document.pdfDoc.numPages,
            indexedPageCount: document.pages?.length ?? 0,
        } : null;
    }

    async search(query: string, scopeIds: string[]): Promise<SearchResult[]> {
        const documents = [...this.documents.values()].filter(document =>
            scopeIds.length === 0 || scopeIds.includes(document.docId),
        );
        await Promise.all(documents.map(document => document.ready));

        const results: SearchResult[] = [];
        for (const document of documents) {
            if (this.documents.get(document.docId) !== document || !document.pages) continue;
            const remaining = 1000 - results.length;
            if (remaining <= 0) break;
            for (const match of searchKeywordPages(document.pages, query, remaining)) {
                results.push({
                    docId: document.docId,
                    pdfFingerprint: document.pdfFingerprint,
                    page: match.page.page,
                    text: match.snippet,
                    bbox: matchBounds(match),
                    spans: match.spans.map(span => ({
                        text: span.text,
                        bbox: span.bbox,
                        char_start: span.start,
                        char_end: span.end,
                    })),
                });
            }
        }
        return results;
    }
}

export const localSearchRegistry = new LocalSearchRegistry();
