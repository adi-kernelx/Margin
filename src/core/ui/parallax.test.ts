import { describe, expect, it } from 'vitest';
import { gradientField, parallaxOffset } from './parallax';

const base = { width: 200, height: 100, maxOffset: 20 };

describe('parallaxOffset', () => {
    it('is still at the centre', () => {
        const offset = parallaxOffset({ ...base, pointerX: 100, pointerY: 50, depth: 1 });
        expect(offset.x).toBeCloseTo(0);
        expect(offset.y).toBeCloseTo(0);
    });

    it('moves nearer layers further', () => {
        const near = parallaxOffset({ ...base, pointerX: 200, pointerY: 100, depth: 1 });
        const far = parallaxOffset({ ...base, pointerX: 200, pointerY: 100, depth: 0.25 });
        expect(near).toEqual({ x: 20, y: 20 });
        expect(far).toEqual({ x: 5, y: 5 });
    });

    it('clamps pointers outside the container', () => {
        expect(parallaxOffset({ ...base, pointerX: -500, pointerY: 900, depth: 1 })).toEqual({ x: -20, y: 20 });
    });

    it('does not move in a zero-size container', () => {
        expect(parallaxOffset({ ...base, width: 0, pointerX: 5, pointerY: 5, depth: 1 })).toEqual({ x: 0, y: 0 });
    });
});

describe('gradientField', () => {
    it('stays within bounds everywhere', () => {
        for (let step = 0; step < 400; step += 1) {
            const sample = gradientField((step % 20) / 20, Math.floor(step / 20) / 20, step * 0.37);
            expect(sample.mix).toBeGreaterThanOrEqual(0);
            expect(sample.mix).toBeLessThanOrEqual(1);
            expect(sample.intensity).toBeGreaterThanOrEqual(0.35);
            expect(sample.intensity).toBeLessThanOrEqual(1);
        }
    });

    it('changes over time', () => {
        expect(gradientField(0.3, 0.6, 0).mix).not.toBeCloseTo(gradientField(0.3, 0.6, 4).mix);
    });
});
