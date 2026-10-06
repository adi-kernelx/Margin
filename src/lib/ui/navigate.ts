// Shared "take me there" behaviour for search results and assistant sources:
// focus the owning document, flash a highlight, and scroll the page into view.

import { useAppStore } from '@/lib/store';
import type { SearchSpan } from '@/lib/search/local-search';

export interface RevealTarget {
    docId: string;
    page: number;
    pdfFingerprint?: string;
    bbox?: { x0: number; y0: number; x1: number; y1: number };
    spans?: SearchSpan[];
}

interface OpenDocument {
    id: string;
    stableId?: string;
    pdfFingerprint?: string;
}

const HIGHLIGHT_MS = 5000;
let clearTimer: number | undefined;

/**
 * Service results can carry a stale session id; the PDF fingerprint (or the
 * persistent stable id) is the reliable way back to the currently open tab.
 */
export function resolveOpenDocumentId(target: Pick<RevealTarget, 'docId' | 'pdfFingerprint'>, documents: readonly OpenDocument[]): string {
    const byFingerprint = target.pdfFingerprint && documents.find(doc => doc.pdfFingerprint === target.pdfFingerprint);
    if (byFingerprint) return byFingerprint.id;
    const direct = documents.find(doc => doc.id === target.docId || doc.stableId === target.docId || doc.pdfFingerprint === target.docId);
    return direct?.id ?? target.docId;
}

export function revealInDocument(
    target: RevealTarget,
    documents: readonly OpenDocument[],
    focusDocument: (docId: string) => void,
    options: { persistHighlight?: boolean } = {},
): void {
    const docId = resolveOpenDocumentId(target, documents);
    const { focusedDocId, setSearchHighlight, clearSearchHighlight } = useAppStore.getState();
    if (docId !== focusedDocId) focusDocument(docId);

    if (target.bbox) {
        setSearchHighlight({ docId, page: target.page, bbox: target.bbox, spans: target.spans?.length ? target.spans : undefined });
        window.clearTimeout(clearTimer);
        if (!options.persistHighlight) clearTimer = window.setTimeout(() => clearSearchHighlight(), HIGHLIGHT_MS);
    }

    // Persistent find-in-PDF results are positioned by the owning PDFViewer.
    // Running the page-level fallback afterwards would re-centre the whole page
    // and undo precise navigation between matches on that same page.
    if (options.persistHighlight) return;

    // Wait a frame for a newly focused pane to mount its pages. PDFViewer also
    // reacts to searchHighlight and performs precise within-page scrolling;
    // this fallback remains useful for assistant sources and newly opened panes.
    window.setTimeout(() => {
        const pane = document.querySelector(`[data-doc-id="${docId}"]`);
        const frame = pane?.querySelector<HTMLElement>(`[data-page-id][data-page-num="${target.page}"]`)
            ?? pane?.querySelector<HTMLElement>(`[data-page-num="${target.page}"]`)?.closest<HTMLElement>('[data-page-id]')
            ?? document.querySelector<HTMLElement>(`[data-page-id][data-page-num="${target.page}"]`);
        frame?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (frame) {
            frame.classList.remove('focus-pulse');
            void frame.offsetWidth;
            frame.classList.add('focus-pulse');
        }
    }, 100);
}
