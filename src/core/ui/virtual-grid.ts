// Pure virtual-grid range calculator.
//
// Given the viewport and a fixed card size, produces the rows and columns
// currently visible plus an overscan margin. Shared between the library grid
// (F4) and the page-organiser thumbnails (F5), so the two never disagree on
// what a "visible" card is.
//
// The virtualiser itself lives in the shell — this module only computes the
// index range and the pixel offsets, so it stays testable in Node.

export interface GridSizing {
    /** Width of the scrollable viewport, in CSS pixels. */
    viewportWidth: number;
    /** Height of the scrollable viewport, in CSS pixels. */
    viewportHeight: number;
    /** Fixed width of one card, including the item gap on its right. */
    itemWidth: number;
    /** Fixed height of one card, including the item gap below. */
    itemHeight: number;
    /** Total number of items in the grid. */
    itemCount: number;
    /** Current scrollTop of the viewport, in CSS pixels. */
    scrollTop: number;
    /** Rows of items to render outside the visible area on each side. */
    overscanRows?: number;
}

export interface GridRange {
    /** Number of full columns per row, clamped to at least one. */
    columns: number;
    /** Total number of rows the grid needs. */
    totalRows: number;
    /** Index of the first item to render (inclusive). */
    startIndex: number;
    /** Index one past the last item to render. */
    endIndex: number;
    /** Height reserved before the first rendered item, in px. */
    offsetTop: number;
    /** Full height of the grid content, in px. Used for the scroll spacer. */
    totalHeight: number;
}

const clampPositive = (value: number) => Math.max(0, Math.floor(value));

/**
 * Returns the range of items to mount and the offsets a spacer div needs.
 * Handles empty grids and zero viewport gracefully; both return a range that
 * mounts nothing but preserves the total height for scroll continuity.
 */
export function computeGridRange(sizing: GridSizing): GridRange {
    const {
        viewportWidth, viewportHeight,
        itemWidth, itemHeight,
        itemCount, scrollTop,
        overscanRows = 2,
    } = sizing;

    if (itemCount <= 0 || itemWidth <= 0 || itemHeight <= 0) {
        return { columns: 1, totalRows: 0, startIndex: 0, endIndex: 0, offsetTop: 0, totalHeight: 0 };
    }

    const columns = Math.max(1, Math.floor(viewportWidth / itemWidth));
    const totalRows = Math.ceil(itemCount / columns);
    const totalHeight = totalRows * itemHeight;

    if (viewportHeight <= 0) {
        return { columns, totalRows, startIndex: 0, endIndex: 0, offsetTop: 0, totalHeight };
    }

    const firstVisibleRow = clampPositive(scrollTop / itemHeight);
    const lastVisibleRow = clampPositive((scrollTop + viewportHeight - 1) / itemHeight);
    const firstRow = Math.max(0, firstVisibleRow - overscanRows);
    const lastRow  = Math.min(totalRows - 1, lastVisibleRow + overscanRows);

    return {
        columns,
        totalRows,
        startIndex: firstRow * columns,
        endIndex: Math.min(itemCount, (lastRow + 1) * columns),
        offsetTop: firstRow * itemHeight,
        totalHeight,
    };
}
