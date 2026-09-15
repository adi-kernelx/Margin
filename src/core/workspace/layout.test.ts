import { describe, expect, it } from 'vitest';
import {
    activateTab,
    addTabs,
    countPanes,
    createLayout,
    moveTab,
    paneIdForTab,
    removeTab,
    resizeSplit,
    splitPane,
    visibleTabIds,
} from './layout';

describe('workspace layout tree', () => {
    it('keeps hidden tabs mounted in state but exposes only the active tab', () => {
        const layout = addTabs(createLayout('root'), 'root', ['a', 'b', 'c']);
        expect(visibleTabIds(layout)).toEqual(['a']);
        expect(visibleTabIds(activateTab(layout, 'c'))).toEqual(['c']);
    });

    it('splits a pane without duplicating the moved tab', () => {
        const layout = addTabs(createLayout('root'), 'root', ['a', 'b']);
        const split = splitPane(layout, 'b', 'root', 'right', 'right-pane', 'split-1');

        expect(countPanes(split)).toBe(2);
        expect(paneIdForTab(split, 'a')).toBe('root');
        expect(paneIdForTab(split, 'b')).toBe('right-pane');
        expect(visibleTabIds(split)).toEqual(['a', 'b']);
    });

    it('collapses an empty source branch when a tab moves', () => {
        const base = addTabs(createLayout('root'), 'root', ['a', 'b']);
        const split = splitPane(base, 'b', 'root', 'right', 'right-pane', 'split-1');
        const moved = moveTab(split, 'b', 'root');

        expect(countPanes(moved)).toBe(1);
        expect(paneIdForTab(moved, 'b')).toBe('root');
        expect(visibleTabIds(moved)).toEqual(['b']);
    });

    it('collapses a split when its last tab closes', () => {
        const base = addTabs(createLayout('root'), 'root', ['a', 'b']);
        const split = splitPane(base, 'b', 'root', 'bottom', 'bottom-pane', 'split-1');
        const closed = removeTab(split, 'b', 'fallback');

        expect(countPanes(closed)).toBe(1);
        expect(paneIdForTab(closed, 'a')).toBe('root');
    });

    it('refuses a fifth rendered pane', () => {
        let layout = addTabs(createLayout('p1'), 'p1', ['a', 'b', 'c', 'd', 'e']);
        layout = splitPane(layout, 'b', 'p1', 'right', 'p2', 's1');
        layout = splitPane(layout, 'c', 'p1', 'bottom', 'p3', 's2');
        layout = splitPane(layout, 'd', 'p2', 'bottom', 'p4', 's3');
        const unchanged = splitPane(layout, 'e', 'p3', 'left', 'p5', 's4');

        expect(countPanes(layout)).toBe(4);
        expect(unchanged).toBe(layout);
    });

    it('clamps divider sizes so neither pane disappears', () => {
        const base = addTabs(createLayout('root'), 'root', ['a', 'b']);
        const split = splitPane(base, 'b', 'root', 'right', 'right-pane', 'split-1');
        const resized = resizeSplit(split, 'split-1', 0.99);

        expect(resized.type).toBe('split');
        if (resized.type === 'split') {
            expect(resized.sizes[0]).toBeCloseTo(0.85);
            expect(resized.sizes[1]).toBeCloseTo(0.15);
        }
    });
});
