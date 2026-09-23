import { describe, expect, it } from 'vitest';
import { groupBy, highlightSegments, snippetAround } from './snippet';

describe('highlightSegments', () => {
    it('marks every case-insensitive occurrence', () => {
        expect(highlightSegments('Prime numbers and primes', 'prime')).toEqual([
            { text: 'Prime', match: true },
            { text: ' numbers and ', match: false },
            { text: 'prime', match: true },
            { text: 's', match: false },
        ]);
    });

    it('prefers the longest overlapping term', () => {
        expect(highlightSegments('eigenvalue', 'eigen eigenvalue')).toEqual([{ text: 'eigenvalue', match: true }]);
    });

    it('returns the whole text unmarked for an empty query', () => {
        expect(highlightSegments('abc', '  ')).toEqual([{ text: 'abc', match: false }]);
        expect(highlightSegments('', 'x')).toEqual([]);
    });

    it('reassembles to the original text', () => {
        const text = 'The Riemann hypothesis and the zeta function';
        expect(highlightSegments(text, 'the zeta').map(segment => segment.text).join('')).toBe(text);
    });
});

describe('snippetAround', () => {
    const text = `${'lead '.repeat(40)}the target word ${'tail '.repeat(40)}`;

    it('centres on the first hit with ellipses on cut sides', () => {
        const snippet = snippetAround(text, 'target', 30);
        expect(snippet.startsWith('…')).toBe(true);
        expect(snippet.endsWith('…')).toBe(true);
        expect(snippet).toContain('target');
    });

    it('returns short text whole', () => {
        expect(snippetAround('short  text', 'text')).toBe('short text');
    });
});

describe('groupBy', () => {
    it('keeps first-seen group order', () => {
        const groups = groupBy(['b1', 'a1', 'b2'], item => item[0]);
        expect(groups).toEqual([{ key: 'b', items: ['b1', 'b2'] }, { key: 'a', items: ['a1'] }]);
    });
});
