export interface IndexedTextSpan {
    text: string;
    start: number;
    end: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface IndexedSearchPage {
    docId: string;
    pdfFingerprint: string;
    page: number;
    text: string;
    spans: IndexedTextSpan[];
}

export interface KeywordMatch {
    page: IndexedSearchPage;
    start: number;
    end: number;
    snippet: string;
    spans: IndexedTextSpan[];
}

export function resolveSearchScopeIds(scope: 'current' | 'all' | string, currentDocId?: string | null): string[] {
    if (scope === 'all') return [];
    if (scope === 'current') return currentDocId ? [currentDocId] : [];
    return [scope];
}

export function normalizeKeywordQuery(value: string): string {
    return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function snippetFor(text: string, start: number, end: number, radius = 80): string {
    let snippetStart = Math.max(0, start - radius);
    let snippetEnd = Math.min(text.length, end + radius);

    if (snippetStart > 0) {
        const nextSpace = text.indexOf(' ', snippetStart);
        if (nextSpace >= 0 && nextSpace < start) snippetStart = nextSpace + 1;
    }
    if (snippetEnd < text.length) {
        const previousSpace = text.lastIndexOf(' ', snippetEnd);
        if (previousSpace > end) snippetEnd = previousSpace;
    }

    return `${snippetStart > 0 ? '…' : ''}${text.slice(snippetStart, snippetEnd)}${snippetEnd < text.length ? '…' : ''}`;
}

/**
 * Literal, case-insensitive keyword search over native PDF text.
 *
 * Every occurrence is returned in page order. There is deliberately no
 * stemming, fuzzy matching, ranking, embeddings, or OCR fallback here.
 */
export function searchKeywordPages(
    pages: readonly IndexedSearchPage[],
    rawQuery: string,
    limit = 1000,
): KeywordMatch[] {
    const query = normalizeKeywordQuery(rawQuery);
    if (!query || limit <= 0) return [];

    const matches: KeywordMatch[] = [];
    for (const page of pages) {
        const searchableText = page.text.toLocaleLowerCase();
        let from = 0;
        while (from <= searchableText.length - query.length) {
            const start = searchableText.indexOf(query, from);
            if (start < 0) break;
            const end = start + query.length;
            const spans = page.spans
                .filter(span => span.end > start && span.start < end)
                .map(span => {
                    const overlapStart = Math.max(start, span.start);
                    const overlapEnd = Math.min(end, span.end);
                    const spanLength = Math.max(1, span.end - span.start);
                    const startRatio = (overlapStart - span.start) / spanLength;
                    const endRatio = (overlapEnd - span.start) / spanLength;
                    const width = span.bbox.x1 - span.bbox.x0;
                    return {
                        ...span,
                        text: page.text.slice(overlapStart, overlapEnd),
                        start: overlapStart,
                        end: overlapEnd,
                        bbox: {
                            ...span.bbox,
                            x0: span.bbox.x0 + width * startRatio,
                            x1: span.bbox.x0 + width * endRatio,
                        },
                    };
                });
            matches.push({
                page,
                start,
                end,
                snippet: snippetFor(page.text, start, end),
                spans: spans.length ? spans : page.spans.slice(0, 1),
            });
            if (matches.length >= limit) return matches;
            from = end;
        }
    }
    return matches;
}

export function matchBounds(match: Pick<KeywordMatch, 'spans'>) {
    if (!match.spans.length) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    return {
        x0: Math.min(...match.spans.map(span => span.bbox.x0)),
        y0: Math.min(...match.spans.map(span => span.bbox.y0)),
        x1: Math.max(...match.spans.map(span => span.bbox.x1)),
        y1: Math.max(...match.spans.map(span => span.bbox.y1)),
    };
}
