export interface VirtualRange {
    startIndex: number;
    endIndex: number;
    offsetTop: number;
    totalHeight: number;
}

export function calculateVirtualRange(
    itemCount: number,
    rowHeight: number,
    viewportHeight: number,
    scrollTop: number,
    overscan = 3,
): VirtualRange {
    if (itemCount < 0 || rowHeight <= 0 || viewportHeight < 0 || overscan < 0) {
        throw new RangeError('Virtual-list dimensions and overscan must be non-negative, with a positive row height.');
    }

    const safeScrollTop = Math.max(0, scrollTop);
    const visibleStart = Math.floor(safeScrollTop / rowHeight);
    const visibleCount = Math.ceil(viewportHeight / rowHeight);
    const startIndex = Math.max(0, Math.min(itemCount, visibleStart - overscan));
    const endIndex = Math.max(startIndex, Math.min(itemCount, visibleStart + visibleCount + overscan));

    return {
        startIndex,
        endIndex,
        offsetTop: startIndex * rowHeight,
        totalHeight: itemCount * rowHeight,
    };
}
