import { describe, expect, it } from 'vitest';
import { buildFullTextIndex, matchBounds, resolveSearchScopeIds, searchFullTextIndex, tokenize, type IndexedSearchPage } from './index';

const page = (pageNumber: number, text: string): IndexedSearchPage => ({
    docId: 'doc',
    pdfFingerprint: 'fingerprint',
    page: pageNumber,
    text,
    spans: [{ text, start: 0, end: text.length, bbox: { x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.3 } }],
});
describe('full text index', () => {
    it('tokenizes Unicode mathematical prose', () => {
        expect(tokenize('Café λ2 + Matrix')).toEqual(['café', 'λ2', 'matrix']);
    });

    it('requires every query term and boosts exact phrases', () => {
        const index = buildFullTextIndex([
            page(1, 'linear algebra studies vector spaces'),
            page(2, 'algebra is linear in this sentence'),
            page(3, 'linear calculus'),
        ]);
        const results = searchFullTextIndex(index, 'linear algebra');
        expect(results.map(result => result.page.page)).toEqual([1, 2]);
        expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('returns the matching span bounds', () => {
        const [result] = searchFullTextIndex(buildFullTextIndex([page(1, 'eigenvalue')]), 'eigenvalue');
        expect(matchBounds(result)).toEqual({ x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.3 });
    });

    it('uses stable document ids for current and explicit search scopes', () => {
        expect(resolveSearchScopeIds('current', 'open-doc')).toEqual(['open-doc']);
        expect(resolveSearchScopeIds('another-doc', 'open-doc')).toEqual(['another-doc']);
        expect(resolveSearchScopeIds('all', 'open-doc')).toEqual([]);
    });
});
