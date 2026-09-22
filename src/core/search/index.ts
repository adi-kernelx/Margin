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

interface Posting {
    pageIndex: number;
    frequency: number;
}

export interface FullTextIndex {
    pages: IndexedSearchPage[];
    postings: Map<string, Posting[]>;
}

export interface IndexedMatch {
    page: IndexedSearchPage;
    score: number;
    snippet: string;
    spans: IndexedTextSpan[];
}

export function resolveSearchScopeIds(scope: 'current' | 'all' | string, currentDocId?: string | null): string[] {
    if (scope === 'all') return [];
    if (scope === 'current') return currentDocId ? [currentDocId] : [];
    return [scope];
}

export function tokenize(text: string): string[] {
    return text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function buildFullTextIndex(pages: IndexedSearchPage[]): FullTextIndex {
    const postings = new Map<string, Posting[]>();
    pages.forEach((page, pageIndex) => {
        const counts = new Map<string, number>();
        for (const token of tokenize(page.text)) counts.set(token, (counts.get(token) ?? 0) + 1);
        for (const [token, frequency] of counts) {
            const tokenPostings = postings.get(token) ?? [];
            tokenPostings.push({ pageIndex, frequency });
            postings.set(token, tokenPostings);
        }
    });
    return { pages, postings };
}

const unionBounds = (spans: IndexedTextSpan[]) => ({
    x0: Math.min(...spans.map(span => span.bbox.x0)),
    y0: Math.min(...spans.map(span => span.bbox.y0)),
    x1: Math.max(...spans.map(span => span.bbox.x1)),
    y1: Math.max(...spans.map(span => span.bbox.y1)),
});

export function searchFullTextIndex(index: FullTextIndex, rawQuery: string, limit = 50): IndexedMatch[] {
    const terms = [...new Set(tokenize(rawQuery))];
    if (!terms.length) return [];
    const candidateSets = terms.map(term => new Set((index.postings.get(term) ?? []).map(item => item.pageIndex)));
    const candidates = [...candidateSets[0]].filter(pageIndex => candidateSets.every(set => set.has(pageIndex)));
    const normalizedQuery = terms.join(' ');

    return candidates.map(pageIndex => {
        const page = index.pages[pageIndex];
        const lowerText = page.text.toLocaleLowerCase();
        const phraseIndex = lowerText.indexOf(normalizedQuery);
        const firstIndex = phraseIndex >= 0
            ? phraseIndex
            : Math.min(...terms.map(term => lowerText.indexOf(term)).filter(index => index >= 0));
        const start = Math.max(0, firstIndex - 60);
        const end = Math.min(page.text.length, firstIndex + normalizedQuery.length + 90);
        const matchingSpans = page.spans.filter(span =>
            span.end >= firstIndex && span.start <= firstIndex + normalizedQuery.length
            || terms.some(term => span.text.toLocaleLowerCase().includes(term)),
        );
        const termScore = terms.reduce((score, term) => {
            const posting = index.postings.get(term)?.find(item => item.pageIndex === pageIndex);
            const documentFrequency = index.postings.get(term)?.length ?? 1;
            return score + (posting?.frequency ?? 0) * Math.log(1 + index.pages.length / documentFrequency);
        }, 0);
        return {
            page,
            score: termScore + (phraseIndex >= 0 ? 5 : 0),
            snippet: `${start > 0 ? '…' : ''}${page.text.slice(start, end)}${end < page.text.length ? '…' : ''}`,
            spans: matchingSpans.length ? matchingSpans : page.spans.slice(0, 1),
        };
    }).sort((a, b) => b.score - a.score || a.page.page - b.page.page).slice(0, limit);
}

export function matchBounds(match: IndexedMatch) {
    return match.spans.length ? unionBounds(match.spans) : { x0: 0, y0: 0, x1: 1, y1: 1 };
}
