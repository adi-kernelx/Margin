import { describe, expect, it } from 'vitest';
import { calculateVirtualRange } from './virtual-range';

describe('calculateVirtualRange', () => {
    it('renders the visible rows plus overscan', () => {
        expect(calculateVirtualRange(1000, 40, 200, 400, 2)).toEqual({
            startIndex: 8,
            endIndex: 17,
            offsetTop: 320,
            totalHeight: 40000,
        });
    });

    it('clamps the range at both ends', () => {
        expect(calculateVirtualRange(4, 40, 200, -20, 3)).toEqual({
            startIndex: 0,
            endIndex: 4,
            offsetTop: 0,
            totalHeight: 160,
        });
    });

    it('rejects invalid dimensions', () => {
        expect(() => calculateVirtualRange(4, 0, 200, 0)).toThrow(RangeError);
    });
});
