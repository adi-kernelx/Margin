import { describe, expect, it } from 'vitest';
import { makeShape, strokeCovering } from '@/core/annotations/test-factories';
import { rotateAnnotation } from './annotations';

describe('page annotation rotation', () => {
    it('round-trips normalized stroke points', () => {
        const stroke = strokeCovering({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, 'ink');
        const clockwise = rotateAnnotation(stroke, 90);
        const restored = rotateAnnotation(clockwise, -90);
        if (restored.type !== 'stroke') throw new Error('Expected stroke');
        restored.geometry.points.forEach((point, index) => {
            expect(point.x).toBeCloseTo(stroke.geometry.points[index].x);
            expect(point.y).toBeCloseTo(stroke.geometry.points[index].y);
        });
    });

    it('rotates bounding boxes with the page', () => {
        const shape = makeShape({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, 'shape');
        const rotated = rotateAnnotation(shape, 90);
        if (rotated.type !== 'shape') throw new Error('Expected shape');
        expect(rotated.geometry.boundingBox.x).toBeCloseTo(0.4);
        expect(rotated.geometry.boundingBox).toMatchObject({ y: 0.1, width: 0.4, height: 0.3 });
    });
});
