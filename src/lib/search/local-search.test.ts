import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createPageDocument, pageDocumentRevision } from '@/core/pages/document';
import { createInitialPageDocument, describePdfSource, materializePageDocument } from '@/lib/pages/pdf-pages';
import type { IndexedSearchPage } from '@/core/search/index';
import { LocalSearchRegistry, type SearchIndexStore } from './local-search';

class MemorySearchStore implements SearchIndexStore {
    private pages = new Map<string, IndexedSearchPage[]>();

    async load(pdfFingerprint: string, docId: string, revision: string) {
        return (this.pages.get(`${pdfFingerprint}:${revision}`) ?? []).map(page => ({ ...page, docId }));
    }

    async replace(pdfFingerprint: string, revision: string, pages: IndexedSearchPage[]) {
        this.pages.set(`${pdfFingerprint}:${revision}`, pages);
    }
}

async function createTextPdf(text: string): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([300, 400]);
    page.drawText(text, { x: 30, y: 330, size: 16, font });
    return pdf.save();
}

async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
    return getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
}

describe('local search document lifecycle', () => {
    it('indexes text from a newly materialized merged PDF', async () => {
        const firstBytes = await createTextPdf('original eigenvalue theorem');
        const secondBytes = await createTextPdf('merged orthogonality lemma');
        const initialDocument = await createInitialPageDocument(firstBytes, 'original');
        const mergedPages = await describePdfSource(secondBytes, 'merged');
        const mergedDocument = createPageDocument([...initialDocument.pages, ...mergedPages]);
        const loadSource = async (sourceId: string) => sourceId === 'original' ? firstBytes : sourceId === 'merged' ? secondBytes : null;
        const initialPdf = await openPdf(await materializePageDocument(initialDocument, loadSource));
        const mergedPdf = await openPdf(await materializePageDocument(mergedDocument, loadSource));
        const registry = new LocalSearchRegistry(new MemorySearchStore());

        const disposeInitial = registry.register(
            'doc', initialPdf.fingerprints[0] ?? 'initial', pageDocumentRevision(initialDocument), initialPdf, () => ({}),
        );
        await registry.waitUntilReady('doc');
        expect(await registry.search('eigenvalue', ['doc'])).toHaveLength(1);

        registry.register(
            'doc', mergedPdf.fingerprints[0] ?? 'merged', pageDocumentRevision(mergedDocument), mergedPdf, () => ({}),
        );
        disposeInitial();
        await registry.waitUntilReady('doc');

        const results = await registry.search('orthogonality', [mergedPdf.fingerprints[0] ?? 'merged']);
        expect(results).toMatchObject([{ docId: 'doc', page: 2 }]);
        expect(registry.getRegistrationState('doc')).toMatchObject({ pageCount: 2, indexedPageCount: 2 });

        await initialPdf.destroy();
        await mergedPdf.destroy();
    });

    it('does not let a late old generation replace or unregister the new index', async () => {
        let releaseOld!: () => void;
        const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
        const fakePdf = (text: string, gate?: Promise<void>) => ({
            numPages: 1,
            getPage: async () => {
                await gate;
                return {
                    getViewport: () => ({ width: 100, height: 100 }),
                    getTextContent: async () => ({ items: [{ str: text, transform: [1, 0, 0, 12, 10, 80], width: 60, height: 12 }] }),
                };
            },
        }) as unknown as PDFDocumentProxy;
        const registry = new LocalSearchRegistry(new MemorySearchStore());
        const disposeOld = registry.register('doc', 'fingerprint', 'old', fakePdf('stale phrase', oldGate), () => ({}));
        registry.register('doc', 'fingerprint', 'new', fakePdf('current phrase'), () => ({}));
        disposeOld();
        await registry.waitUntilReady('doc');
        releaseOld();
        await Promise.resolve();

        expect(await registry.search('current', ['doc'])).toHaveLength(1);
        expect(await registry.search('stale', ['doc'])).toHaveLength(0);
        expect(registry.getRegistrationState('doc')?.documentRevision).toBe('new');
    });
});
