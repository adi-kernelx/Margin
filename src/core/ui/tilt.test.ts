import { describe, expect, it } from 'vitest';
import { computeTilt, RESTING_TILT } from './tilt';

const card = { width: 200, height: 300, maxTiltDegrees: 4 };

describe('computeTilt', () => {
    it('sits flat at the exact centre', () => {
        // The rotations may come back as -0 from arithmetic on 0-valued
        // normalised positions; toBeCloseTo treats +0 and -0 as equal.
        const result = computeTilt({ pointerX: 100, pointerY: 150, ...card });
        expect(result.rotateX).toBeCloseTo(0);
        expect(result.rotateY).toBeCloseTo(0);
        expect(result.sheenX).toBe(50);
        expect(result.sheenY).toBe(50);
    });

    it('tips its top away from the viewer when the pointer is near the top edge', () => {
        // Pointer above centre → the card should lean back, i.e. rotateX > 0.
        const { rotateX } = computeTilt({ pointerX: 100, pointerY: 0, ...card });
        expect(rotateX).toBeGreaterThan(0);
    });

    it('turns its right edge away from the viewer when the pointer is on the right', () => {
        // Pointer right of centre → rotateY > 0.
        const { rotateY } = computeTilt({ pointerX: 200, pointerY: 150, ...card });
        expect(rotateY).toBeGreaterThan(0);
    });

    it('caps rotation at maxTiltDegrees on every axis', () => {
        // Overshoot the top-left corner: normalised position is clamped to
        // [-0.5, 0.5], so absolute rotation must not exceed the cap.
        const { rotateX, rotateY } = computeTilt({ pointerX: -1000, pointerY: -1000, ...card });
        expect(Math.abs(rotateX)).toBeLessThanOrEqual(card.maxTiltDegrees);
        expect(Math.abs(rotateY)).toBeLessThanOrEqual(card.maxTiltDegrees);
    });

    it('places the sheen where the pointer is, as percentages', () => {
        const { sheenX, sheenY } = computeTilt({ pointerX: 50, pointerY: 75, ...card });
        expect(sheenX).toBeCloseTo(25);
        expect(sheenY).toBeCloseTo(25);
    });

    it('returns the resting output for degenerate inputs', () => {
        expect(computeTilt({ pointerX: 10, pointerY: 10, width: 0, height: 300, maxTiltDegrees: 4 }))
            .toEqual(RESTING_TILT);
        expect(computeTilt({ pointerX: 10, pointerY: 10, width: 200, height: 300, maxTiltDegrees: 0 }))
            .toEqual(RESTING_TILT);
    });
});
