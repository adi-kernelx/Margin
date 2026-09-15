import { describe, expect, it } from 'vitest';
import { erasePolyline, polylineIntersectsCapsule, squaredDistanceSegmentToSegment } from './geometry';

describe('exact eraser geometry', () => {
    it('detects crossings even when no sampled stroke point is inside the eraser', () => {
        expect(polylineIntersectsCapsule(
            [{ x: 0, y: 5 }, { x: 10, y: 5 }],
            [{ x: 5, y: 0 }, { x: 5, y: 10 }],
            0.25,
        )).toBe(true);
    });

    it('computes the exact distance between disjoint segments', () => {
        expect(squaredDistanceSegmentToSegment(
            { x: 0, y: 0 }, { x: 4, y: 0 },
            { x: 2, y: 3 }, { x: 6, y: 3 },
        )).toBeCloseTo(9);
    });

    it('splits at swept-disc boundaries rather than at captured samples', () => {
        const segments = erasePolyline(
            [{ x: 0, y: 0 }, { x: 10, y: 0 }],
            [{ x: 5, y: 0 }],
            1,
        );
        expect(segments).toHaveLength(2);
        expect(segments[0].at(-1)?.x).toBeCloseTo(4, 6);
        expect(segments[1][0].x).toBeCloseTo(6, 6);
    });

    it('returns the original stroke when the eraser misses', () => {
        const stroke = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
        expect(erasePolyline(stroke, [{ x: 5, y: 10 }], 1)).toEqual([stroke]);
    });
});
