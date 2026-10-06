import { describe, expect, it } from 'vitest';
import {
    matchBounds,
    normalizeKeywordQuery,
    resolveSearchScopeIds,
    searchKeywordPages,
    type IndexedSearchPage,
} from './index';

const page = (pageNumber: number, text: string, spans = [{
    text,
    start: 0,
    end: text.length,
    bbox: { x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.3 },
}]): IndexedSearchPage => ({
    docId: 'doc',
    pdfFingerprint: 'fingerprint',
    page: pageNumber,
    text,
    spans,
});

describe('native PDF keyword search', () => {
    it('normalizes whitespace and case in a literal query', () => {
        expect(normalizeKeywordQuery('  Linear\n  Algebra ')).toBe('linear algebra');
        expect(searchKeywordPages([page(1, 'LINEAR algebra')], ' linear  algebra ')).toHaveLength(1);
    });

    it('does not treat separate terms as a phrase match', () => {
        const pages = [
            page(1, 'linear algebra studies vector spaces'),
            page(2, 'algebra is linear in this sentence'),
        ];
        expect(searchKeywordPages(pages, 'linear algebra').map(match => match.page.page)).toEqual([1]);
    });

    it('returns every occurrence in page order without ranking', () => {
        const matches = searchKeywordPages([
            page(1, 'matrix then matrix'),
            page(2, 'matrix'),
        ], 'matrix');
        expect(matches.map(match => [match.page.page, match.start])).toEqual([[1, 0], [1, 12], [2, 0]]);
    });

    it('returns only spans overlapping the literal match', () => {
        const spans = [
            { text: 'first', start: 0, end: 5, bbox: { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 } },
            { text: 'target', start: 6, end: 12, bbox: { x0: 0.3, y0: 0.4, x1: 0.6, y1: 0.5 } },
        ];
        const [result] = searchKeywordPages([page(1, 'first target', spans)], 'target');
        expect(result.spans).toEqual([spans[1]]);
        expect(matchBounds(result)).toEqual(spans[1].bbox);
    });

    it('crops a text-item box to the exact matched characters', () => {
        const [result] = searchKeywordPages([page(1, 'prefix target suffix')], 'target');
        expect(result.spans[0].text).toBe('target');
        expect(result.spans[0].bbox.x0).toBeCloseTo(0.1 + 0.7 * (7 / 20));
        expect(result.spans[0].bbox.x1).toBeCloseTo(0.1 + 0.7 * (13 / 20));
    });

    it('uses stable document ids for current and explicit search scopes', () => {
        expect(resolveSearchScopeIds('current', 'open-doc')).toEqual(['open-doc']);
        expect(resolveSearchScopeIds('another-doc', 'open-doc')).toEqual(['another-doc']);
        expect(resolveSearchScopeIds('all', 'open-doc')).toEqual([]);
    });
});
