import type { CubicBezierSegment, StrokePoint } from '../annotations/models';

interface PixelPoint extends StrokePoint {
    x: number;
    y: number;
}

export interface ProcessedStroke {
    points: StrokePoint[];
    beziers: CubicBezierSegment[];
    sourcePointCount: number;
    storedCoordinateCount: number;
    compressionRatio: number;
}

function toPixel(point: StrokePoint, width: number, height: number): PixelPoint {
    return { ...point, x: point.x * width, y: point.y * height };
}

function toNormal(point: PixelPoint, width: number, height: number): StrokePoint {
    return { ...point, x: point.x / width, y: point.y / height };
}

function pointSegmentDistance(point: PixelPoint, start: PixelPoint, end: PixelPoint): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function simplifyStroke(points: StrokePoint[], width: number, height: number, epsilonPx: number): StrokePoint[] {
    if (points.length < 3) return [...points];
    const pixels = points.map(point => toPixel(point, width, height));

    const simplify = (start: number, end: number, keep: Set<number>) => {
        let furthest = -1;
        let maxDistance = epsilonPx;
        for (let index = start + 1; index < end; index += 1) {
            const distance = pointSegmentDistance(pixels[index], pixels[start], pixels[end]);
            if (distance > maxDistance) {
                maxDistance = distance;
                furthest = index;
            }
        }
        if (furthest >= 0) {
            keep.add(furthest);
            simplify(start, furthest, keep);
            simplify(furthest, end, keep);
        }
    };

    const keep = new Set([0, points.length - 1]);
    simplify(0, points.length - 1, keep);
    return [...keep].sort((a, b) => a - b).map(index => points[index]);
}

function chordParameters(points: PixelPoint[]): number[] {
    const distances = [0];
    for (let index = 1; index < points.length; index += 1) {
        distances.push(distances[index - 1] + Math.hypot(
            points[index].x - points[index - 1].x,
            points[index].y - points[index - 1].y,
        ));
    }
    const total = distances.at(-1) || 1;
    return distances.map(distance => distance / total);
}

function normalise(x: number, y: number): { x: number; y: number } {
    const length = Math.hypot(x, y) || 1;
    return { x: x / length, y: y / length };
}

function evaluateBezier(curve: CubicBezierSegment, t: number): { x: number; y: number } {
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b3 = t * t * t;
    return {
        x: b0 * curve.start.x + b1 * curve.control1.x + b2 * curve.control2.x + b3 * curve.end.x,
        y: b0 * curve.start.y + b1 * curve.control1.y + b2 * curve.control2.y + b3 * curve.end.y,
    };
}

function fitSingle(points: PixelPoint[]): { curve: CubicBezierSegment; error: number; split: number } {
    const start = points[0];
    const end = points.at(-1)!;
    const left = normalise(points[1].x - start.x, points[1].y - start.y);
    const beforeEnd = points.at(-2)!;
    const right = normalise(beforeEnd.x - end.x, beforeEnd.y - end.y);
    const parameters = chordParameters(points);
    let c00 = 0;
    let c01 = 0;
    let c11 = 0;
    let x0 = 0;
    let x1 = 0;

    for (let index = 0; index < points.length; index += 1) {
        const t = parameters[index];
        const mt = 1 - t;
        const b0 = mt * mt * mt;
        const b1 = 3 * mt * mt * t;
        const b2 = 3 * mt * t * t;
        const b3 = t * t * t;
        const baseX = (b0 + b1) * start.x + (b2 + b3) * end.x;
        const baseY = (b0 + b1) * start.y + (b2 + b3) * end.y;
        const a1x = left.x * b1;
        const a1y = left.y * b1;
        const a2x = right.x * b2;
        const a2y = right.y * b2;
        const rx = points[index].x - baseX;
        const ry = points[index].y - baseY;
        c00 += a1x * a1x + a1y * a1y;
        c01 += a1x * a2x + a1y * a2y;
        c11 += a2x * a2x + a2y * a2y;
        x0 += a1x * rx + a1y * ry;
        x1 += a2x * rx + a2y * ry;
    }

    const determinant = c00 * c11 - c01 * c01;
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    let alpha1 = segmentLength / 3;
    let alpha2 = segmentLength / 3;
    if (Math.abs(determinant) > 1e-9) {
        alpha1 = (x0 * c11 - x1 * c01) / determinant;
        alpha2 = (c00 * x1 - c01 * x0) / determinant;
        if (alpha1 <= 0 || alpha2 <= 0) alpha1 = alpha2 = segmentLength / 3;
    }

    const curve: CubicBezierSegment = {
        start: { x: start.x, y: start.y },
        control1: { x: start.x + left.x * alpha1, y: start.y + left.y * alpha1 },
        control2: { x: end.x + right.x * alpha2, y: end.y + right.y * alpha2 },
        end: { x: end.x, y: end.y },
    };
    let error = 0;
    let split = Math.floor(points.length / 2);
    for (let index = 1; index < points.length - 1; index += 1) {
        const candidate = evaluateBezier(curve, parameters[index]);
        const distance = Math.hypot(candidate.x - points[index].x, candidate.y - points[index].y);
        if (distance > error) {
            error = distance;
            split = index;
        }
    }
    return { curve, error, split };
}

export function fitCubicBeziers(
    points: StrokePoint[],
    width: number,
    height: number,
    epsilonPx: number,
): CubicBezierSegment[] {
    if (points.length < 2) return [];
    const pixels = points.map(point => toPixel(point, width, height));
    const fit = (segment: PixelPoint[]): CubicBezierSegment[] => {
        if (segment.length === 2) return [fitSingle(segment).curve];
        const candidate = fitSingle(segment);
        if (candidate.error <= epsilonPx || segment.length <= 3) return [candidate.curve];
        return [
            ...fit(segment.slice(0, candidate.split + 1)),
            ...fit(segment.slice(candidate.split)),
        ];
    };
    return fit(pixels).map(curve => ({
        start: toNormal(curve.start, width, height),
        control1: toNormal(curve.control1, width, height),
        control2: toNormal(curve.control2, width, height),
        end: toNormal(curve.end, width, height),
    }));
}

export function processStroke(
    source: StrokePoint[],
    width: number,
    height: number,
    epsilonPx = 0.75,
): ProcessedStroke {
    // Split the total error budget: RDP can move the source by ε/3 and the
    // cubic fit may use the remaining 2ε/3. By the triangle inequality the
    // complete stored path remains within the advertised ε.
    const points = simplifyStroke(source, width, height, epsilonPx / 3);
    const beziers = fitCubicBeziers(points, width, height, epsilonPx * 2 / 3);
    const storedCoordinateCount = beziers.length * 6 + 2;
    const sourceCoordinateCount = Math.max(1, source.length * 2);
    return {
        points,
        beziers,
        sourcePointCount: source.length,
        storedCoordinateCount,
        compressionRatio: storedCoordinateCount / sourceCoordinateCount,
    };
}
