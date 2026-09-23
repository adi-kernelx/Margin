import { describe, expect, it } from 'vitest';
import { fuzzyMatch, fuzzyRank } from './fuzzy';

describe('fuzzyMatch', () => {
    it('matches characters in order, case-insensitively', () => {
        expect(fuzzyMatch('SPL', 'Split pages')?.positions).toEqual([0, 1, 2]);
    });

    it('rejects candidates missing a character or out of order', () => {
        expect(fuzzyMatch('xyz', 'Split pages')).toBeNull();
        expect(fuzzyMatch('ps', 'Split')).toBeNull();
    });

    it('treats an empty query as a neutral match', () => {
        expect(fuzzyMatch('  ', 'Anything')).toEqual({ score: 0, positions: [] });
    });

    it('ignores spaces in the query', () => {
        expect(fuzzyMatch('o s', 'Open settings')).not.toBeNull();
    });

    it('scores word starts above mid-word matches', () => {
        const wordStart = fuzzyMatch('p', 'Split pages')!;
        const midWord = fuzzyMatch('p', 'Split')!;
        expect(wordStart.score).toBeGreaterThan(midWord.score);
    });
});

describe('fuzzyRank', () => {
    const commands = ['Export PDF', 'Split pages', 'Open settings', 'Toggle dark mode'];

    it('orders the strongest match first', () => {
        const ranked = fuzzyRank('sp', commands, text => [text]).map(entry => entry.item);
        expect(ranked[0]).toBe('Split pages');
        expect(ranked).not.toContain('Toggle dark mode');
    });

    it('prefers a contiguous word-start run over scattered initials', () => {
        const ranked = fuzzyRank('set', ['Select tool', 'Open settings'], text => [text]).map(entry => entry.item);
        expect(ranked[0]).toBe('Open settings');
    });

    it('keeps input order for an empty query', () => {
        expect(fuzzyRank('', commands, text => [text]).map(entry => entry.item)).toEqual(commands);
    });

    it('uses the best of several texts per item', () => {
        const items = [{ title: 'Theme', keywords: ['dark mode'] }];
        expect(fuzzyRank('dark', items, item => [item.title, ...item.keywords])).toHaveLength(1);
    });
});
