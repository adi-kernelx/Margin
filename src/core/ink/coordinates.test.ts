import { describe, expect, it } from 'vitest';
import { PageCoordinates, applyAffine, invertAffine, topLeftPageCoordinates } from './coordinates';

describe('PageCoordinates', () => {
    it('round-trips an affine PDF viewport', () => {
        const matrix = { a: 0, b: 2, c: 2, d: 0, e: 10, f: 20 };
        const inverse = invertAffine(matrix);
        const point = { x: 11, y: 17 };
        expect(applyAffine(inverse, applyAffine(matrix, point))).toEqual(point);
    });

    it('maps top-left screen space to bottom-left PDF space', () => {
        const coordinates = topLeftPageCoordinates(600, 800);
        expect(coordinates.screenToPdf({ x: 20, y: 30 })).toEqual({ x: 20, y: 770 });
        expect(coordinates.pdfToScreen({ x: 20, y: 770 })).toEqual({ x: 20, y: 30 });
    });

    it('keeps normalized compatibility conversion in one place', () => {
        const coordinates = new PageCoordinates(600, 800, { a: 1, b: 0, c: 0, d: -1, e: 0, f: 800 });
        const normalized = coordinates.screenToNormalized({ x: 150, y: 200 });
        expect(normalized).toEqual({ x: 0.25, y: 0.25 });
        expect(coordinates.normalizedToScreen(normalized)).toEqual({ x: 150, y: 200 });
    });
});
