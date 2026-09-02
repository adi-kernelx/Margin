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
    docId: string;
    pdfFingerprint: string;
    pdfDoc: any; // pdfjsLib.PDFDocumentProxy
    getOcrData: () => any; // Function to get current OCR data lazily
}

class LocalSearchRegistry {
    private documents: Map<string, RegisteredDocument> = new Map();

    register(docId: string, pdfFingerprint: string, pdfDoc: any, getOcrData: () => any) {
        this.documents.set(docId, { docId, pdfFingerprint, pdfDoc, getOcrData });
    }

    unregister(docId: string) {
        this.documents.delete(docId);
    }

    async search(query: string, scopeIds: string[]): Promise<SearchResult[]> {
        if (!query.trim()) return [];
        const lowerQuery = query.toLowerCase().trim();
        const results: SearchResult[] = [];

        for (const [docId, doc] of this.documents.entries()) {
            // scopeIds allows filtering. If empty, assume search all.
            if (scopeIds.length > 0 && !scopeIds.includes(docId) && !scopeIds.includes(doc.pdfFingerprint)) {
                continue;
            }

            try {
                const docResults = await this.searchDocument(doc, lowerQuery);
                results.push(...docResults);
            } catch (err) {
                console.error(`[LocalSearch] Error searching doc ${docId}:`, err);
            }
        }

        // Sort by score
        return results.sort((a, b) => b.score - a.score);
    }

    private async searchDocument(doc: RegisteredDocument, query: string): Promise<SearchResult[]> {
        const results: SearchResult[] = [];
        const numPages = doc.pdfDoc.numPages;
        const ocrData = doc.getOcrData() || {};

        for (let i = 1; i <= numPages; i++) {
            const page = await doc.pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: 1.0 });
            const pageW = viewport.width;
            const pageH = viewport.height;

            // 1. Search Native Text
            try {
                const textContent = await page.getTextContent();
                for (const item of textContent.items) {
                    if (!item.str) continue;
                    const text = item.str;
                    if (text.toLowerCase().includes(query)) {
                        // Extract bounds
                        const x = item.transform[4];
                        const y = item.transform[5];
                        const width = item.width || 0;
                        const height = item.height || Math.abs(item.transform[3]) || 12;

                        const x0 = Math.max(0, Math.min(1, x / pageW));
                        const x1 = Math.max(0, Math.min(1, (x + width) / pageW));
                        
                        // item.transform[5] (y) is the baseline from bottom
                        const y0 = Math.max(0, Math.min(1, (pageH - y - height) / pageH));
                        const y1 = Math.max(0, Math.min(1, (pageH - y + height * 0.2) / pageH));

                        const matchIndex = text.toLowerCase().indexOf(query);
                        let snippetStart = Math.max(0, matchIndex - 30);
                        let snippetEnd = Math.min(text.length, matchIndex + query.length + 30);
                        let snippet = text.substring(snippetStart, snippetEnd);
                        if (snippetStart > 0) snippet = "..." + snippet;
                        if (snippetEnd < text.length) snippet = snippet + "...";

                        results.push({
                            score: 1.0,
                            docId: doc.docId,
                            pdfFingerprint: doc.pdfFingerprint,
                            page: i,
                            text: snippet,
                            bbox: { x0, y0, x1, y1 },
                            spans: [{
                                text: item.str,
                                bbox: { x0, y0, x1, y1 }
                            }]
                        });
                    }
                }
            } catch (err) {
                console.error(`[LocalSearch] Native text extraction failed on page ${i}:`, err);
            }

            // 2. Search OCR Text
            try {
                const pageOcr = ocrData[i];
                if (pageOcr && pageOcr.tokens) {
                    for (const token of pageOcr.tokens) {
                        if (!token.text) continue;
                        if (token.text.toLowerCase().includes(query)) {
                            const x0 = Math.max(0, Math.min(1, token.bbox.x));
                            const y0 = Math.max(0, Math.min(1, token.bbox.y));
                            const x1 = Math.max(0, Math.min(1, token.bbox.x + token.bbox.w));
                            const y1 = Math.max(0, Math.min(1, token.bbox.y + token.bbox.h));

                            results.push({
                                score: 0.9,
                                docId: doc.docId,
                                pdfFingerprint: doc.pdfFingerprint,
                                page: i,
                                text: `[OCR] ...${token.text}...`,
                                bbox: { x0, y0, x1, y1 },
                                spans: [{
                                    text: token.text,
                                    bbox: { x0, y0, x1, y1 }
                                }]
                            });
                        }
                    }
                }
            } catch (err) {
                console.error(`[LocalSearch] OCR search failed on page ${i}:`, err);
            }
        }

        return results;
    }
}

export const localSearchRegistry = new LocalSearchRegistry();

if (typeof window !== 'undefined') {
    (window as any).__LOCAL_SEARCH_REGISTRY__ = localSearchRegistry;
}
