import { describe, expect, it } from 'vitest';
import type { Annotation } from '@/core/annotations/models';
import { applyOperationToPageDocument, applyPageOperation, attachAnnotationsToPageIds, createPageDocument, rotateBy } from './document';
import { createBatchOperation, createDeletePageOperation, createMovePageOperation } from '@/core/annotations/operations';
import type { PageRecord } from './models';

const page = (id: string): PageRecord => ({
    id,
    kind: 'blank',
    width: 612,
    height: 792,
    rotation: 0,
});

describe('stable page document', () => {
    it('moves pages without changing their identity', () => {
        const initial = createPageDocument([page('a'), page('b'), page('c')]);
        const moved = applyPageOperation(initial, { type: 'move-page', data: { pageId: 'a', toIndex: 2 } });
        expect(moved.pages.map(item => item.id)).toEqual(['b', 'c', 'a']);
        expect(initial.pages.map(item => item.id)).toEqual(['a', 'b', 'c']);
    });

    it('round-trips page commands through their inverse', () => {
        const initial = createPageDocument([page('a'), page('b'), page('c')]);
        const operation = createMovePageOperation('a', 0, 2, 'doc');
        const moved = applyOperationToPageDocument(initial, operation);
        expect(applyOperationToPageDocument(moved, operation.inverse!)).toEqual(initial);
    });

    it('never deletes the final page', () => {
        const initial = createPageDocument([page('a')]);
        expect(applyPageOperation(initial, { type: 'delete-page', data: { pageId: 'a' } })).toBe(initial);
    });

    it('restores a multi-page deletion in the exact original order', () => {
        const initial = createPageDocument([page('a'), page('b'), page('c'), page('d')]);
        const operation = createBatchOperation([
            createDeletePageOperation(initial.pages[2], 2, 'doc'),
            createDeletePageOperation(initial.pages[0], 0, 'doc'),
        ], 'doc');
        const deleted = applyOperationToPageDocument(initial, operation);
        expect(deleted.pages.map(item => item.id)).toEqual(['b', 'd']);
        expect(applyOperationToPageDocument(deleted, operation.inverse!)).toEqual(initial);
    });

    it('normalizes rotation in both directions', () => {
        expect(rotateBy(0, -90)).toBe(270);
        expect(rotateBy(270, 90)).toBe(0);
    });

    it('migrates legacy page numbers once, then follows the page id', () => {
        const annotation = { id: 'ink', pageNum: 2 } as Annotation;
        const initial = createPageDocument([page('a'), page('b')]);
        const migrated = attachAnnotationsToPageIds([annotation], initial);
        const reordered = createPageDocument([page('b'), page('a')]);
        expect(migrated[0].pageId).toBe('b');
        expect(attachAnnotationsToPageIds(migrated, reordered)[0]).toMatchObject({ pageId: 'b', pageNum: 1 });
    });

    it('rejects duplicate page ids', () => {
        expect(() => createPageDocument([page('a'), page('a')])).toThrow('Duplicate page id');
    });
});
