import { describe, expect, it } from 'vitest';
import {
    appendMessage,
    confidenceBand,
    conversationTitle,
    formatElapsed,
    parsePageList,
    resolveRequestScope,
    sourceLabel,
    sourceRegion,
    type AssistantSource,
    type Conversation,
} from './conversation';

const empty: Conversation = { id: 'c', docId: 'd', title: 'New conversation', messages: [], createdAt: 0, updatedAt: 0 };

describe('conversationTitle', () => {
    it('uses the first question, collapsed and truncated', () => {
        const long = `What   is ${'x'.repeat(100)}`;
        const title = conversationTitle([{ id: '1', role: 'user', text: long, createdAt: 0 }]);
        expect(title.startsWith('What is')).toBe(true);
        expect(title.length).toBeLessThanOrEqual(60);
        expect(title.endsWith('…')).toBe(true);
    });

    it('falls back when there is no question yet', () => {
        expect(conversationTitle([])).toBe('New conversation');
    });
});

describe('appendMessage', () => {
    it('does not mutate and updates title and timestamp', () => {
        const next = appendMessage(empty, { id: '1', role: 'user', text: 'Define a ring', createdAt: 42 });
        expect(empty.messages).toHaveLength(0);
        expect(next).toMatchObject({ title: 'Define a ring', updatedAt: 42 });
    });
});

describe('confidenceBand', () => {
    it('buckets confidence', () => {
        expect(confidenceBand(0.9)).toBe('high');
        expect(confidenceBand(0.5)).toBe('medium');
        expect(confidenceBand(0.1)).toBe('low');
    });
});

describe('resolveRequestScope', () => {
    const base = { focusedDocId: 'a', openDocIds: ['a', 'b'], pages: [2, 3] };

    it('limits to the focused document', () => {
        expect(resolveRequestScope({ ...base, kind: 'document' })).toEqual({ docIds: ['a'] });
    });

    it('spans all open documents', () => {
        expect(resolveRequestScope({ ...base, kind: 'open' })).toEqual({ docIds: ['a', 'b'] });
    });

    it('adds pages only when some were chosen', () => {
        expect(resolveRequestScope({ ...base, kind: 'pages' })).toEqual({ docIds: ['a'], pages: [2, 3] });
        expect(resolveRequestScope({ ...base, kind: 'pages', pages: [] })).toEqual({ docIds: ['a'] });
    });

    it('is unscoped without a focused document', () => {
        expect(resolveRequestScope({ ...base, kind: 'document', focusedDocId: null })).toBeUndefined();
    });
});

describe('parsePageList', () => {
    it('parses ranges and singles, sorted and unique', () => {
        expect(parsePageList('7, 1-3, 2')).toEqual([1, 2, 3, 7]);
    });

    it('ignores invalid parts', () => {
        expect(parsePageList('0, 5-2, abc, 4')).toEqual([4]);
    });
});

describe('formatElapsed', () => {
    it('formats seconds and minutes', () => {
        expect(formatElapsed(4_200)).toBe('4s');
        expect(formatElapsed(65_000)).toBe('1m 05s');
    });
});

describe('sources', () => {
    const passage: AssistantSource = { docId: 'd', page: 4, text: 't', score: 0.1, kind: 'passage', bbox: [0.1, 0.2, 0.9, 0.3] };
    const concept: AssistantSource = {
        docId: 'd', page: 2, text: 't', score: 0.2, kind: 'concept', title: 'Plane tree', type: 'Definition',
        verified: true, bbox: { x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.5 },
    };

    it('labels passages by page and concepts by type and title', () => {
        expect(sourceLabel(passage)).toBe('p. 4');
        expect(sourceLabel(concept)).toBe('Definition: Plane tree · p. 2');
        expect(sourceLabel({ docId: 'd', page: 7, text: '', score: 0 })).toBe('p. 7');
    });

    it('gives a region only for concepts, from either box shape', () => {
        expect(sourceRegion(passage)).toBeUndefined();
        expect(sourceRegion(concept)).toEqual({ x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.5 });
        expect(sourceRegion({ ...concept, bbox: [0.1, 0.4, 0.9, 0.5] })).toEqual({ x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.5 });
        expect(sourceRegion({ ...concept, bbox: null })).toBeUndefined();
        expect(sourceRegion({ ...concept, bbox: [0.1] })).toBeUndefined();
    });
});
