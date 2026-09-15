import type { StrokePoint } from '../annotations/models';
import { normalizedToScreen, screenToNormalized } from '@/core/ink/coordinates';

/**
 * Smooth a stroke using Catmull-Rom spline interpolation
 */
export function catmullRomSmooth(points: StrokePoint[], tension = 0.5): StrokePoint[] {
    if (points.length < 4) return points;

    const smoothed: StrokePoint[] = [];

    // Add first point
    smoothed.push(points[0]);

    // Interpolate between each set of 4 points
    for (let i = 0; i < points.length - 3; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const p2 = points[i + 2];
        const p3 = points[i + 3];

        // Generate interpolated points
        for (let t = 0; t <= 1; t += 0.1) {
            const tt = t * t;
            const ttt = tt * t;

            const q0 = -tension * ttt + 2 * tension * tt - tension * t;
            const q1 = (2 - tension) * ttt + (tension - 3) * tt + 1;
            const q2 = (tension - 2) * ttt + (3 - 2 * tension) * tt + tension * t;
            const q3 = tension * ttt - tension * tt;

            const x = q0 * p0.x + q1 * p1.x + q2 * p2.x + q3 * p3.x;
            const y = q0 * p0.y + q1 * p1.y + q2 * p2.y + q3 * p3.y;

            // Average pressure if available
            const pressure = (p1.pressure !== undefined && p2.pressure !== undefined)
                ? (1 - t) * p1.pressure + t * p2.pressure
                : undefined;

            smoothed.push({ x, y, pressure });
        }
    }

    // Add last point
    smoothed.push(points[points.length - 1]);

    return smoothed;
}

/**
 * Simplify a stroke using Ramer-Douglas-Peucker algorithm
 * Reduces the number of points while preserving shape
 */
export function ramerDouglasPeucker(points: StrokePoint[], epsilon: number): StrokePoint[] {
    if (points.length < 3) return points;

    // Find the point with maximum distance
    let maxDistance = 0;
    let index = 0;

    const start = points[0];
    const end = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const distance = perpendicularDistance(points[i], start, end);
        if (distance > maxDistance) {
            maxDistance = distance;
            index = i;
        }
    }

    // If max distance is greater than epsilon, recursively simplify
    if (maxDistance > epsilon) {
        const leftSegment = ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
        const rightSegment = ramerDouglasPeucker(points.slice(index), epsilon);

        // Combine segments (remove duplicate middle point)
        return leftSegment.slice(0, -1).concat(rightSegment);
    } else {
        // Return just the endpoints
        return [start, end];
    }
}

/**
 * Calculate perpendicular distance from point to line
 */
export function perpendicularDistance(
    point: StrokePoint,
    lineStart: StrokePoint,
    lineEnd: StrokePoint
): number {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;

    if (dx === 0 && dy === 0) {
        // Line start and end are the same point
        return Math.sqrt(
            Math.pow(point.x - lineStart.x, 2) +
            Math.pow(point.y - lineStart.y, 2)
        );
    }

    const numerator = Math.abs(
        dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x
    );
    const denominator = Math.sqrt(dx * dx + dy * dy);

    return numerator / denominator;
}

/**
 * Convert screen coordinates to normalized page coordinates (0-1)
 */
export function normalizePoint(
    x: number,
    y: number,
    pageWidth: number,
    pageHeight: number
): { x: number; y: number } {
    return screenToNormalized({ x, y }, pageWidth, pageHeight);
}

/**
 * Convert normalized coordinates back to screen coordinates
 */
export function denormalizePoint(
    x: number,
    y: number,
    pageWidth: number,
    pageHeight: number
): { x: number; y: number } {
    return normalizedToScreen({ x, y }, pageWidth, pageHeight);
}
