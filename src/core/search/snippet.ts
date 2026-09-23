// Pure helpers for presenting search results: a centred snippet around the
// first hit, split into matched and unmatched segments for highlighting, and
// stable grouping by document.

export interface SnippetSegment {
    text: string;
    match: boolean;
}

function queryTerms(query: string): string[] {
    return [...new Set(query.toLowerCase().split(/\s+/).filter(term => term.length > 0))]
        .sort((a, b) => b.length - a.length);
}

/** Splits `text` into segments, marking every case-insensitive occurrence of a query term. */
export function highlightSegments(text: string, query: string): SnippetSegment[] {
    const terms = queryTerms(query);
    if (!terms.length || !text) return text ? [{ text, match: false }] : [];
    const lower = text.toLowerCase();
    const segments: SnippetSegment[] = [];
    let plainStart = 0;
    let index = 0;
    while (index < text.length) {
        const term = terms.find(candidate => lower.startsWith(candidate, index));
        if (!term) {
            index += 1;
            continue;
        }
        if (index > plainStart) segments.push({ text: text.slice(plainStart, index), match: false });
        segments.push({ text: text.slice(index, index + term.length), match: true });
        index += term.length;
        plainStart = index;
    }
    if (plainStart < text.length) segments.push({ text: text.slice(plainStart), match: false });
    return segments;
}

/**
 * Cuts a window of roughly `radius` characters on each side of the first
 * matching term, trimmed to word boundaries and marked with ellipses.
 */
export function snippetAround(text: string, query: string, radius = 60): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    const lower = clean.toLowerCase();
    const first = queryTerms(query)
        .map(term => lower.indexOf(term))
        .filter(position => position >= 0)
        .sort((a, b) => a - b)[0] ?? 0;
    let start = Math.max(0, first - radius);
    let end = Math.min(clean.length, first + radius);
    if (start > 0) {
        const space = clean.indexOf(' ', start);
        if (space !== -1 && space < first) start = space + 1;
    }
    if (end < clean.length) {
        const space = clean.lastIndexOf(' ', end);
        if (space > first) end = space;
    }
    return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}

/** Groups items by key, preserving first-seen group order and item order. */
export function groupBy<T>(items: readonly T[], key: (item: T) => string): { key: string; items: T[] }[] {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        const id = key(item);
        const bucket = groups.get(id);
        if (bucket) bucket.push(item);
        else groups.set(id, [item]);
    }
    return [...groups].map(([groupKey, groupItems]) => ({ key: groupKey, items: groupItems }));
}
