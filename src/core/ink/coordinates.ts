import type { Point2D } from './geometry';

export interface AffineMatrix {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
}

export function applyAffine(matrix: AffineMatrix, point: Point2D): Point2D {
    return {
        x: matrix.a * point.x + matrix.c * point.y + matrix.e,
        y: matrix.b * point.x + matrix.d * point.y + matrix.f,
    };
}

export function invertAffine(matrix: AffineMatrix): AffineMatrix {
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (Math.abs(determinant) < 1e-12) throw new Error('Cannot invert a singular page transform');
    return {
        a: matrix.d / determinant,
        b: -matrix.b / determinant,
        c: -matrix.c / determinant,
        d: matrix.a / determinant,
        e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
        f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
    };
}

/**
 * The single boundary between CSS pixels, normalized legacy storage, and PDF
 * user space. PDF.js supplies `screenFromPdf` as viewport.transform.
 */
export class PageCoordinates {
    private readonly pdfFromScreen: AffineMatrix;
    readonly width: number;
    readonly height: number;
    readonly screenFromPdf: AffineMatrix;

    constructor(
        width: number,
        height: number,
        screenFromPdf: AffineMatrix,
    ) {
        if (width <= 0 || height <= 0) throw new Error('Page dimensions must be positive');
        this.width = width;
        this.height = height;
        this.screenFromPdf = screenFromPdf;
        this.pdfFromScreen = invertAffine(screenFromPdf);
    }

    screenToNormalized(point: Point2D): Point2D {
        return { x: point.x / this.width, y: point.y / this.height };
    }

    normalizedToScreen(point: Point2D): Point2D {
        return { x: point.x * this.width, y: point.y * this.height };
    }

    screenToPdf(point: Point2D): Point2D {
        return applyAffine(this.pdfFromScreen, point);
    }

    pdfToScreen(point: Point2D): Point2D {
        return applyAffine(this.screenFromPdf, point);
    }
}

export function topLeftPageCoordinates(width: number, height: number): PageCoordinates {
    // Compatibility transform for tools that do not yet receive a PDF viewport.
    return new PageCoordinates(width, height, { a: 1, b: 0, c: 0, d: -1, e: 0, f: height });
}

export function screenToNormalized(point: Point2D, width: number, height: number): Point2D {
    if (width <= 0 || height <= 0) throw new Error('Page dimensions must be positive');
    return { x: point.x / width, y: point.y / height };
}

export function normalizedToScreen(point: Point2D, width: number, height: number): Point2D {
    if (width <= 0 || height <= 0) throw new Error('Page dimensions must be positive');
    return { x: point.x * width, y: point.y * height };
}
