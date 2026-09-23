import { describe, expect, it } from 'vitest';
import { computeFlip, IDENTITY_DELTA, invertTransform } from './flip';

describe('computeFlip', () => {
    it('yields the identity when an item did not move', () => {
        const rect = { x: 10, y: 20, width: 100, height: 200 };
        expect(computeFlip(rect, rect)).toEqual(IDENTITY_DELTA);
    });

    it('reports the axis-aligned displacement between old and new positions', () => {
        const delta = computeFlip(
            { x: 100, y: 200, width: 50, height: 50 },
            { x: 20,  y: 80,  width: 50, height: 50 },
        );
        expect(delta.dx).toBe(80);
        expect(delta.dy).toBe(120);
        expect(delta.sx).toBe(1);
        expect(delta.sy).toBe(1);
    });

    it('captures a size change as a scale factor', () => {
        const delta = computeFlip(
            { x: 0, y: 0, width: 100, height: 50 },
            { x: 0, y: 0, width: 50,  height: 100 },
        );
        expect(delta.sx).toBe(2);
        expect(delta.sy).toBe(0.5);
    });

    it('does not divide by zero for a zero-size after rect', () => {
        expect(computeFlip(
            { x: 0, y: 0, width: 100, height: 100 },
            { x: 0, y: 0, width: 0,   height: 0   },
        )).toEqual({ dx: 0, dy: 0, sx: 1, sy: 1 });
    });
});

describe('invertTransform', () => {
    it('produces a translate + scale CSS transform', () => {
        expect(invertTransform({ dx: 12, dy: 34, sx: 1, sy: 1 }))
            .toBe('translate(12.00px, 34.00px) scale(1.0000, 1.0000)');
    });
});
