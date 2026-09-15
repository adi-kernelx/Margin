import type { StrokePoint } from '../annotations/models';

export interface Point2D {
    x: number;
    y: number;
}

export interface Interval {
    start: number;
    end: number;
}

const EPSILON = 1e-9;

export function squaredDistancePointToSegment(point: Point2D, start: Point2D, end: Point2D): number {
    const vx = end.x - start.x;
    const vy = end.y - start.y;
    const lengthSquared = vx * vx + vy * vy;
    if (lengthSquared <= EPSILON) {
        const dx = point.x - start.x;
        const dy = point.y - start.y;
        return dx * dx + dy * dy;
    }

    const projection = Math.max(0, Math.min(1,
        ((point.x - start.x) * vx + (point.y - start.y) * vy) / lengthSquared,
    ));
    const dx = point.x - (start.x + projection * vx);
    const dy = point.y - (start.y + projection * vy);
    return dx * dx + dy * dy;
}

function orientation(a: Point2D, b: Point2D, c: Point2D): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
    const o1 = orientation(a, b, c);
    const o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a);
    const o4 = orientation(c, d, b);
    if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON))
        && ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) {
        return true;
    }
    return Math.abs(o1) <= EPSILON && squaredDistancePointToSegment(c, a, b) <= EPSILON
        || Math.abs(o2) <= EPSILON && squaredDistancePointToSegment(d, a, b) <= EPSILON
        || Math.abs(o3) <= EPSILON && squaredDistancePointToSegment(a, c, d) <= EPSILON
        || Math.abs(o4) <= EPSILON && squaredDistancePointToSegment(b, c, d) <= EPSILON;
}

export function squaredDistanceSegmentToSegment(
    a: Point2D,
    b: Point2D,
    c: Point2D,
    d: Point2D,
): number {
    if (segmentsIntersect(a, b, c, d)) return 0;
    return Math.min(
        squaredDistancePointToSegment(a, c, d),
        squaredDistancePointToSegment(b, c, d),
        squaredDistancePointToSegment(c, a, b),
        squaredDistancePointToSegment(d, a, b),
    );
}

function intersectIntervals(a: Interval | null, b: Interval | null): Interval | null {
    if (!a || !b) return null;
    const start = Math.max(a.start, b.start);
    const end = Math.min(a.end, b.end);
    return start <= end + EPSILON ? { start, end } : null;
}

function linearInterval(value: number, delta: number, min: number, max: number): Interval | null {
    if (Math.abs(delta) <= EPSILON) return value >= min && value <= max ? { start: 0, end: 1 } : null;
    const t1 = (min - value) / delta;
    const t2 = (max - value) / delta;
    const start = Math.max(0, Math.min(t1, t2));
    const end = Math.min(1, Math.max(t1, t2));
    return start <= end + EPSILON ? { start, end } : null;
}

function circleInterval(start: Point2D, end: Point2D, centre: Point2D, radius: number): Interval | null {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const fx = start.x - centre.x;
    const fy = start.y - centre.y;
    const a = dx * dx + dy * dy;
    if (a <= EPSILON) {
        return fx * fx + fy * fy <= radius * radius ? { start: 0, end: 1 } : null;
    }
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(Math.max(0, discriminant));
    const entry = (-b - root) / (2 * a);
    const exit = (-b + root) / (2 * a);
    const clipped = { start: Math.max(0, entry), end: Math.min(1, exit) };
    return clipped.start <= clipped.end + EPSILON ? clipped : null;
}

function segmentCapsuleIntervals(
    start: Point2D,
    end: Point2D,
    capsuleStart: Point2D,
    capsuleEnd: Point2D,
    radius: number,
): Interval[] {
    const intervals: Interval[] = [];
    const capA = circleInterval(start, end, capsuleStart, radius);
    const capB = circleInterval(start, end, capsuleEnd, radius);
    if (capA) intervals.push(capA);
    if (capB) intervals.push(capB);

    const cx = capsuleEnd.x - capsuleStart.x;
    const cy = capsuleEnd.y - capsuleStart.y;
    const length = Math.hypot(cx, cy);
    if (length > EPSILON) {
        const ux = cx / length;
        const uy = cy / length;
        const sx = start.x - capsuleStart.x;
        const sy = start.y - capsuleStart.y;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const projection = linearInterval(sx * ux + sy * uy, dx * ux + dy * uy, 0, length);
        const perpendicular = linearInterval(sx * -uy + sy * ux, dx * -uy + dy * ux, -radius, radius);
        const strip = intersectIntervals(projection, perpendicular);
        if (strip) intervals.push(strip);
    }
    return mergeIntervals(intervals);
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
    if (intervals.length === 0) return [];
    const sorted = intervals
        .map(({ start, end }) => ({ start: Math.max(0, start), end: Math.min(1, end) }))
        .filter(({ start, end }) => start <= end)
        .sort((a, b) => a.start - b.start);
    const merged: Interval[] = [];
    for (const interval of sorted) {
        const previous = merged.at(-1);
        if (previous && interval.start <= previous.end + EPSILON) previous.end = Math.max(previous.end, interval.end);
        else merged.push({ ...interval });
    }
    return merged;
}

export function polylineIntersectsCapsule(
    stroke: Point2D[],
    eraserPath: Point2D[],
    radius: number,
): boolean {
    if (stroke.length === 0 || eraserPath.length === 0) return false;
    if (stroke.length === 1) {
        if (eraserPath.length === 1) return squaredDistancePointToSegment(stroke[0], eraserPath[0], eraserPath[0]) <= radius * radius;
        return eraserPath.slice(1).some((point, index) =>
            squaredDistancePointToSegment(stroke[0], eraserPath[index], point) <= radius * radius,
        );
    }
    const eraserSegments = eraserPath.length === 1
        ? [[eraserPath[0], eraserPath[0]] as const]
        : eraserPath.slice(1).map((point, index) => [eraserPath[index], point] as const);
    for (let i = 1; i < stroke.length; i += 1) {
        for (const [a, b] of eraserSegments) {
            if (squaredDistanceSegmentToSegment(stroke[i - 1], stroke[i], a, b) <= radius * radius) return true;
        }
    }
    return false;
}

function interpolatePoint(start: StrokePoint, end: StrokePoint, t: number): StrokePoint {
    const optional = (a: number | undefined, b: number | undefined) =>
        a === undefined || b === undefined ? undefined : a + (b - a) * t;
    return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        pressure: optional(start.pressure, end.pressure),
        timestamp: optional(start.timestamp, end.timestamp),
    };
}

/** Subtracts the exact swept-disc intervals from a polyline and interpolates new boundary points. */
export function erasePolyline(points: StrokePoint[], eraserPath: Point2D[], radius: number): StrokePoint[][] {
    if (points.length < 2 || eraserPath.length === 0) return points.length >= 2 ? [points] : [];
    const eraserSegments = eraserPath.length === 1
        ? [[eraserPath[0], eraserPath[0]] as const]
        : eraserPath.slice(1).map((point, index) => [eraserPath[index], point] as const);
    const result: StrokePoint[][] = [];
    let current: StrokePoint[] = [];
    const flush = () => {
        if (current.length >= 2) result.push(current);
        current = [];
    };

    for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        const erased = mergeIntervals(eraserSegments.flatMap(([a, b]) =>
            segmentCapsuleIntervals(start, end, a, b, radius),
        ));
        let cursor = 0;
        for (const interval of erased) {
            if (interval.start > cursor + EPSILON) {
                const keptStart = interpolatePoint(start, end, cursor);
                const keptEnd = interpolatePoint(start, end, interval.start);
                if (current.length === 0) current.push(keptStart);
                current.push(keptEnd);
            }
            flush();
            cursor = Math.max(cursor, interval.end);
        }
        if (cursor < 1 - EPSILON) {
            const keptStart = interpolatePoint(start, end, cursor);
            if (current.length === 0) current.push(keptStart);
            current.push(end);
        } else if (erased.length === 0) {
            if (current.length === 0) current.push(start);
            current.push(end);
        }
    }
    flush();
    return result;
}
