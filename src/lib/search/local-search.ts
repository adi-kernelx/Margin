import {
    buildFullTextIndex,
    matchBounds,
    searchFullTextIndex,
    type FullTextIndex,
    type IndexedSearchPage,
    type IndexedTextSpan,
} from '@/core/search/index';
import type { OcrPageResult } from '@/lib/ocr/client-ocr';
import { searchIndexStorage } from './storage';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export type SearchSpan = {
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    char_start?: number;
    char_end?: number;
};

export type SearchResult = {
    score: number;
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
    getOcrData: () => Record<number, OcrPageResult>;
    index: FullTextIndex | null;
    ready: Promise<void>;
}

export interface SearchIndexStore {
    load(pdfFingerprint: string, docId: string, documentRevision: string): Promise<IndexedSearchPage[]>;
    replace(pdfFingerprint: string, documentRevision: string, pages: IndexedSearchPage[]): Promise<void>;
}

export interface SearchRegistrationState {
    generation: number;
    documentRevision: string;
    pageCount: number;
    indexedPageCount: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

async function extractPage(document: RegisteredDocument, pageNumber: number): Promise<IndexedSearchPage> {
    const page = await document.pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const spans: IndexedTextSpan[] = [];
    let text = '';

    const append = (value: string, bbox: IndexedTextSpan['bbox']) => {
        const clean = value.replace(/\s+/g, ' ').trim();
        if (!clean) return;
        const start = text.length ? text.length + 1 : 0;
        text += `${text ? ' ' : ''}${clean}`;
        spans.push({ text: clean, start, end: start + clean.length, bbox });
    };

    const native = await page.getTextContent();
    for (const item of native.items) {
        if (!('str' in item) || !item.str) continue;
        const x = item.transform[4] ?? 0;
        const y = item.transform[5] ?? 0;
        const width = item.width ?? 0;
        const height = item.height ?? Math.abs(item.transform[3] ?? 12);
        append(item.str, {
            x0: clamp(x / viewport.width),
            y0: clamp((viewport.height - y - height) / viewport.height),
            x1: clamp((x + width) / viewport.width),
            y1: clamp((viewport.height - y + height * 0.2) / viewport.height),
        });
    }

    const nativeTerms = new Set(spans.map(span => span.text.toLocaleLowerCase()));
    for (const token of document.getOcrData()[pageNumber]?.tokens ?? []) {
        if (!token.text || nativeTerms.has(token.text.toLocaleLowerCase())) continue;
        append(token.text, {
            x0: clamp(token.bbox.x),
            y0: clamp(token.bbox.y),
            x1: clamp(token.bbox.x + token.bbox.w),
            y1: clamp(token.bbox.y + token.bbox.h),
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
    private refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private generations = new Map<string, number>();
    private readonly storage: SearchIndexStore;

    constructor(storage: SearchIndexStore = searchIndexStorage) {
        this.storage = storage;
    }

    register(
        docId: string,
        pdfFingerprint: string,
        documentRevision: string,
        pdfDoc: PDFDocumentProxy,
        getOcrData: () => Record<number, OcrPageResult>,
    ): () => void {
        const previousTimer = this.refreshTimers.get(docId);
        if (previousTimer) clearTimeout(previousTimer);
        this.refreshTimers.delete(docId);
        const generation = (this.generations.get(docId) ?? 0) + 1;
        this.generations.set(docId, generation);
        const document: RegisteredDocument = {
            generation,
            docId,
            pdfFingerprint,
            documentRevision,
            pdfDoc,
            getOcrData,
            index: null,
            ready: Promise.resolve(),
        };
        this.documents.set(docId, document);
        document.ready = this.prepareIndex(document);
        return () => this.unregister(docId, generation);
    }

    unregister(docId: string, generation?: number) {
        const current = this.documents.get(docId);
        if (generation !== undefined && current?.generation !== generation) return;
        this.documents.delete(docId);
        this.generations.set(docId, (this.generations.get(docId) ?? 0) + 1);
        const timer = this.refreshTimers.get(docId);
        if (timer) clearTimeout(timer);
        this.refreshTimers.delete(docId);
    }

    refresh(docId: string) {
        const document = this.documents.get(docId);
        if (!document) return;
        const previous = this.refreshTimers.get(docId);
        if (previous) clearTimeout(previous);
        this.refreshTimers.set(docId, setTimeout(() => {
            if (this.documents.get(docId) !== document) return;
            document.generation = (this.generations.get(docId) ?? document.generation) + 1;
            this.generations.set(docId, document.generation);
            document.ready = this.prepareIndex(document);
            this.refreshTimers.delete(docId);
        }, 500));
    }

    private async prepareIndex(document: RegisteredDocument) {
        const generation = document.generation;
        const isCurrent = () => this.documents.get(document.docId) === document
            && document.generation === generation;
        const cached = await this.storage.load(
            document.pdfFingerprint,
            document.docId,
            document.documentRevision,
        );
        if (!isCurrent()) return;
        if (cached.length === document.pdfDoc.numPages) document.index = buildFullTextIndex(cached);

        const hasOcr = Object.values(document.getOcrData()).some(page => page.tokens.length > 0);
        if (document.index && !hasOcr) return;

        const pages: IndexedSearchPage[] = [];
        for (let pageNumber = 1; pageNumber <= document.pdfDoc.numPages; pageNumber++) {
            pages.push(await extractPage(document, pageNumber));
        }
        if (!isCurrent()) return;
        document.index = buildFullTextIndex(pages);
        await this.storage.replace(document.pdfFingerprint, document.documentRevision, pages);
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
            indexedPageCount: document.index?.pages.length ?? 0,
        } : null;
    }

    async search(query: string, scopeIds: string[]): Promise<SearchResult[]> {
        const documents = [...this.documents.values()].filter(document =>
            scopeIds.length === 0
            || scopeIds.includes(document.docId)
            || scopeIds.includes(document.pdfFingerprint),
        );
        await Promise.all(documents.map(document => document.ready));

        return documents.filter(document => this.documents.get(document.docId) === document).flatMap(document => {
            if (!document.index) return [];
            return searchFullTextIndex(document.index, query).map(match => ({
                score: match.score,
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
            }));
        }).sort((a, b) => b.score - a.score).slice(0, 50);
    }
}

export const localSearchRegistry = new LocalSearchRegistry();
