// Indexes an open PDF for the assistant as soon as the RAG service is up.
// Text PDFs are indexed from their own text layer; scanned pages still go
// through OCR (useClientOcr). Loaded lazily, so the static demo never sees it.

import { create } from 'zustand';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useServiceHealthStore } from '@/lib/services/health';
import { ingestPdf, isDocumentIngested } from '@/lib/ingest-service';

interface IndexingState {
    /** Fingerprints being indexed right now. */
    indexing: Record<string, true>;
    /** Bumped when indexing starts and ends, so the panel re-reads the index status. */
    version: number;
}

export const useIndexingStore = create<IndexingState>(() => ({ indexing: {}, version: 0 }));

const attempted = new Set<string>();

async function indexOnce(docId: string, pdfDoc: PDFDocumentProxy, fingerprint: string): Promise<void> {
    if (attempted.has(fingerprint)) return;
    attempted.add(fingerprint);
    try {
        if (await isDocumentIngested(fingerprint)) return;
        useIndexingStore.setState(state => ({ indexing: { ...state.indexing, [fingerprint]: true }, version: state.version + 1 }));
        const result = await ingestPdf(docId, fingerprint, await pdfDoc.getData());
        if (!result?.success) attempted.delete(fingerprint);  // retry when the service is back
    } catch {
        attempted.delete(fingerprint);
    } finally {
        useIndexingStore.setState(state => {
            const indexing = { ...state.indexing };
            delete indexing[fingerprint];
            return { indexing, version: state.version + 1 };
        });
    }
}

/** Starts watching; returns the unsubscribe function. */
export function watchAssistantIndex(docId: string, pdfDoc: PDFDocumentProxy): () => void {
    const fingerprint = pdfDoc.fingerprints?.[0];
    if (!fingerprint) return () => undefined;
    const tryIndex = () => {
        if (useServiceHealthStore.getState().byKey.rag === 'online') void indexOnce(docId, pdfDoc, fingerprint);
    };
    tryIndex();
    return useServiceHealthStore.subscribe(tryIndex);
}
