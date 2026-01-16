import type { TransformMatrix } from '../annotations/models';

/**
 * Calculates the perpendicular distance from a point to a line segment.
 * @param p The point to check.
 * @param v The start point of the segment.
 * @param w The end point of the segment.
 * @returns The distance squared.
 */
export function distToSegmentSquared(p: { x: number, y: number }, v: { x: number, y: number }, w: { x: number, y: number }): number {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = v.x + t * (w.x - v.x);
    const projY = v.y + t * (w.y - v.y);
    return (p.x - projX) ** 2 + (p.y - projY) ** 2;
}

/**
 * Checks if a line segment (p1-p2) intersects with a circle (center, radius).
 */
export function segmentIntersectsCircle(p1: { x: number, y: number }, p2: { x: number, y: number }, center: { x: number, y: number }, radius: number): boolean {
    const distSq = distToSegmentSquared(center, p1, p2);
    return distSq <= radius * radius;
}

/**
 * Checks if a point is inside a polygon (ray casting algorithm).
 */
export function pointInPolygon(point: { x: number, y: number }, vs: { x: number, y: number }[]): boolean {
    let x = point.x, y = point.y;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        let xi = vs[i].x, yi = vs[i].y;
        let xj = vs[j].x, yj = vs[j].y;

        let intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * Checks if a polygon intersects with a circle.
 * Approximate: Checks if any edge intersects circle OR if circle center is inside polygon.
 * Note: Does not cover case where polygon is fully inside circle (unless vertices are checked).
 */
export function polygonIntersectsCircle(points: { x: number, y: number }[], center: { x: number, y: number }, radius: number): boolean {
    // Check if center is inside
    if (pointInPolygon(center, points)) return true;

    // Check if any edge intersects
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        if (segmentIntersectsCircle(p1, p2, center, radius)) return true;
    }

    return false;
}

export function applyTransform(point: { x: number, y: number }, matrix: TransformMatrix): { x: number, y: number } {
    return {
        x: matrix.a * point.x + matrix.c * point.y + matrix.e,
        y: matrix.b * point.x + matrix.d * point.y + matrix.f
    };
}

export function inverseTransform(point: { x: number, y: number }, matrix: TransformMatrix): { x: number, y: number } {
    const det = matrix.a * matrix.d - matrix.b * matrix.c;
    if (det === 0) return point; // Should not happen for valid transforms

    const invDet = 1 / det;
    const x = point.x - matrix.e;
    const y = point.y - matrix.f;

    return {
        x: (matrix.d * x - matrix.c * y) * invDet,
        y: (matrix.a * y - matrix.b * x) * invDet
    };
}
