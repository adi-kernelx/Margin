import { describe, expect, it } from 'vitest';
import { pageIdForSourceIndex, visibleOutlineRows, type OutlineNode } from './outline';

const tree: OutlineNode[] = [
    { id: '1', title: 'Intro', children: [] },
    { id: '2', title: 'Methods', children: [
        { id: '2.1', title: 'Setup', children: [{ id: '2.1.1', title: 'Detail', children: [] }] },
    ] },
];

describe('visibleOutlineRows', () => {
    it('shows only top-level rows when nothing is expanded', () => {
        expect(visibleOutlineRows(tree, new Set()).map(row => row.node.id)).toEqual(['1', '2']);
    });

    it('reveals children of expanded nodes with their depth', () => {
        const rows = visibleOutlineRows(tree, new Set(['2', '2.1']));
        expect(rows.map(row => [row.node.id, row.depth])).toEqual([['1', 0], ['2', 0], ['2.1', 1], ['2.1.1', 2]]);
        expect(rows[1]).toMatchObject({ hasChildren: true, expanded: true });
    });

    it('never marks a leaf as expanded', () => {
        expect(visibleOutlineRows(tree, new Set(['1']))[0].expanded).toBe(false);
    });
});

describe('pageIdForSourceIndex', () => {
    it('follows a page after it has been reordered', () => {
        const pages = [
            { id: 'b', kind: 'pdf', sourcePageIndex: 1 },
            { id: 'blank', kind: 'blank' },
            { id: 'a', kind: 'pdf', sourcePageIndex: 0 },
        ];
        expect(pageIdForSourceIndex(pages, 0)).toBe('a');
        expect(pageIdForSourceIndex(pages, 7)).toBeNull();
    });
});
