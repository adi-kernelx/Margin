import { describe, expect, it } from 'vitest';
import { computeGridRange } from './virtual-grid';

const base = {
    viewportWidth: 800,
    viewportHeight: 600,
    itemWidth: 200,
    itemHeight: 240,
    overscanRows: 0,
};

describe('computeGridRange', () => {
    it('lays out one row of columns at scroll 0', () => {
        const range = computeGridRange({ ...base, itemCount: 20, scrollTop: 0 });
        expect(range.columns).toBe(4);
        expect(range.totalRows).toBe(5);
        expect(range.startIndex).toBe(0);
        // Viewport 600 / row 240 = 2 full rows visible; last-visible is row 2
        // because pixel 599 sits inside row 2, so we mount rows 0..2.
        expect(range.endIndex).toBe(12);
        expect(range.offsetTop).toBe(0);
    });

    it('advances the start index as the viewport scrolls', () => {
        const range = computeGridRange({ ...base, itemCount: 20, scrollTop: 480 });
        // 480 / 240 = row 2; visible rows 2..4.
        expect(range.startIndex).toBe(8);
        expect(range.endIndex).toBe(20);
        expect(range.offsetTop).toBe(480);
    });

    it('expands its range by overscan rows on both sides', () => {
        const range = computeGridRange({ ...base, overscanRows: 1, itemCount: 20, scrollTop: 480 });
        expect(range.startIndex).toBe(4);   // one row before
        expect(range.endIndex).toBe(20);
    });

    it('caps the end index at itemCount for the final row', () => {
        const range = computeGridRange({ ...base, itemCount: 10, scrollTop: 600 });
        expect(range.endIndex).toBeLessThanOrEqual(10);
    });

    it('returns an empty range for zero items', () => {
        expect(computeGridRange({ ...base, itemCount: 0, scrollTop: 0 }))
            .toEqual({ columns: 1, totalRows: 0, startIndex: 0, endIndex: 0, offsetTop: 0, totalHeight: 0 });
    });

    it('preserves the total height when the viewport is collapsed', () => {
        const range = computeGridRange({ ...base, viewportHeight: 0, itemCount: 20, scrollTop: 0 });
        expect(range.totalHeight).toBe(1200);
        expect(range.endIndex).toBe(0);
    });

    it('reports columns of at least one even when items are wider than the viewport', () => {
        const range = computeGridRange({ ...base, viewportWidth: 100, itemCount: 3, scrollTop: 0 });
        expect(range.columns).toBe(1);
        expect(range.totalRows).toBe(3);
    });
});
