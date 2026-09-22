import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex, relativeLuminance } from './contrast';

describe('parseHex', () => {
    it('accepts both #RGB and #RRGGBB', () => {
        expect(parseHex('#000')).toEqual([0, 0, 0]);
        expect(parseHex('#fff')).toEqual([255, 255, 255]);
        expect(parseHex('#0B5E56')).toEqual([11, 94, 86]);
    });

    it('rejects anything else', () => {
        expect(() => parseHex('teal')).toThrow();
        expect(() => parseHex('#12345')).toThrow();
        expect(() => parseHex('#zzzzzz')).toThrow();
    });
});

describe('contrastRatio', () => {
    // WCAG's own worked example: pure black on pure white is 21:1.
    it('reports 21 for black on white', () => {
        expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    });

    it('is symmetric in its arguments', () => {
        expect(contrastRatio('#0B5E56', '#FFFFFF'))
            .toBeCloseTo(contrastRatio('#FFFFFF', '#0B5E56'), 10);
    });

    it('reports 1 when foreground equals background', () => {
        expect(contrastRatio('#333333', '#333333')).toBeCloseTo(1, 10);
    });

    it("meets AA body-text (4.5:1) for Margin's light-mode text on ground", () => {
        // These are the actual F1 values; the token test in styles/ pins them.
        expect(contrastRatio('#0F1418', '#F4F6F8')).toBeGreaterThanOrEqual(4.5);
    });
});

describe('relativeLuminance', () => {
    it('sits at 0 for black and 1 for white', () => {
        expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
        expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    });
});
