import { describe, expect, it } from 'vitest';
import { fitCubicBeziers, processStroke, simplifyStroke } from './stroke-processing';

const wave = (count: number) => Array.from({ length: count }, (_, index) => ({
    x: index / (count - 1),
    y: 0.5 + Math.sin(index / 80) * 0.1,
    timestamp: index * 4,
}));

describe('stroke processing', () => {
    it('RDP keeps endpoints and removes redundant collinear samples', () => {
        const points = Array.from({ length: 101 }, (_, index) => ({ x: index / 100, y: 0.5 }));
        expect(simplifyStroke(points, 1000, 1000, 0.5)).toEqual([points[0], points.at(-1)]);
    });

    it('fits a straight stroke as one cubic with identical endpoints', () => {
        const points = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];
        const curves = fitCubicBeziers(points, 1000, 1000, 0.75);
        expect(curves).toHaveLength(1);
        expect(curves[0].start).toEqual(points[0]);
        expect(curves[0].end).toEqual(points[2]);
    });

    it('meets the fixed storage gate on a densely sampled smooth stroke', () => {
        const processed = processStroke(wave(1000), 1200, 1600, 0.75);
        expect(processed.compressionRatio).toBeLessThanOrEqual(0.2);
        expect(processed.beziers.length).toBeGreaterThan(0);
    });
});
