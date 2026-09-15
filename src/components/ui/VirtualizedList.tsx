import { useState } from 'react';
import type { ReactNode, UIEvent } from 'react';
import { calculateVirtualRange } from '@/core/ui/virtual-range';

interface VirtualizedListProps<T> {
    items: readonly T[];
    rowHeight: number;
    height: number;
    getKey: (item: T) => string;
    renderItem: (item: T, index: number) => ReactNode;
    overscan?: number;
    label: string;
}

export function VirtualizedList<T>({ items, rowHeight, height, getKey, renderItem, overscan = 3, label }: VirtualizedListProps<T>) {
    const [scrollTop, setScrollTop] = useState(0);
    const range = calculateVirtualRange(items.length, rowHeight, height, scrollTop, overscan);
    const visibleItems = items.slice(range.startIndex, range.endIndex);
    const handleScroll = (event: UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop);

    return (
        <div role="list" aria-label={label} className="overflow-auto" style={{ height }} onScroll={handleScroll}>
            <div style={{ height: range.totalHeight, position: 'relative' }}>
                <div style={{ transform: `translateY(${range.offsetTop}px)` }}>
                    {visibleItems.map((item, offset) => (
                        <div role="listitem" key={getKey(item)} style={{ height: rowHeight }}>
                            {renderItem(item, range.startIndex + offset)}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
