import type {
    Annotation,
    BoundingBox,
    CubicBezierSegment,
    Point,
    StrokePoint,
    TextHighlightRect,
} from '@/core/annotations/models';

type QuarterTurn = 90 | -90;

function rotatePoint<T extends Point>(point: T, delta: QuarterTurn): T {
    return {
        ...point,
        x: delta === 90 ? 1 - point.y : point.y,
        y: delta === 90 ? point.x : 1 - point.x,
    };
}

function rotateBox<T extends BoundingBox | TextHighlightRect>(box: T, delta: QuarterTurn): T {
    return {
        ...box,
        x: delta === 90 ? 1 - box.y - box.height : box.y,
        y: delta === 90 ? box.x : 1 - box.x - box.width,
        width: box.height,
        height: box.width,
    };
}

const rotateBezier = (segment: CubicBezierSegment, delta: QuarterTurn): CubicBezierSegment => ({
    start: rotatePoint(segment.start, delta),
    control1: rotatePoint(segment.control1, delta),
    control2: rotatePoint(segment.control2, delta),
    end: rotatePoint(segment.end, delta),
});

/** Rotates normalized annotation geometry with its page content. */
export function rotateAnnotation(annotation: Annotation, delta: QuarterTurn): Annotation {
    const updatedAt = Date.now();
    switch (annotation.type) {
        case 'stroke':
            return {
                ...annotation,
                updatedAt,
                geometry: {
                    ...annotation.geometry,
                    points: annotation.geometry.points.map(point => rotatePoint(point as StrokePoint, delta)),
                    beziers: annotation.geometry.beziers?.map(segment => rotateBezier(segment, delta)),
                },
            };
        case 'highlight':
            return {
                ...annotation,
                updatedAt,
                geometry: {
                    ...annotation.geometry,
                    path: annotation.geometry.path?.map(point => rotatePoint(point as StrokePoint, delta)),
                    rects: annotation.geometry.rects?.map(rect => rotateBox(rect, delta)),
                },
            };
        case 'shape':
            return {
                ...annotation,
                updatedAt,
                geometry: {
                    ...annotation.geometry,
                    boundingBox: rotateBox(annotation.geometry.boundingBox, delta),
                    startPoint: annotation.geometry.startPoint && rotatePoint(annotation.geometry.startPoint, delta),
                    endPoint: annotation.geometry.endPoint && rotatePoint(annotation.geometry.endPoint, delta),
                },
            };
        case 'text':
        case 'image':
        case 'math':
            return {
                ...annotation,
                updatedAt,
                geometry: {
                    ...annotation.geometry,
                    boundingBox: rotateBox(annotation.geometry.boundingBox, delta),
                },
            };
    }
}

