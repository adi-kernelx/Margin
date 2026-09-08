// Builders for annotation fixtures used by the tests.
//
// Annotations carry a lot of required-but-irrelevant fields (style, meta,
// zIndex). Defaulting them here keeps each test showing only the field it
// actually cares about, so a failing test reads as a statement about geometry
// rather than a wall of boilerplate.

import type {
    Annotation,
    AnnotationStyle,
    AnnotationMeta,
    BoundingBox,
    StrokeAnnotation,
    StrokePoint,
    ShapeAnnotation,
} from './models';

const style: AnnotationStyle = {
    color: '#000000',
    opacity: 1,
    width: 2,
};

const meta: AnnotationMeta = {
    tool: 'test',
};

let seq = 0;
export function nextId(prefix = 'a'): string {
    seq += 1;
    return `${prefix}-${seq}`;
}

function base(id: string) {
    return {
        id,
        pageNum: 1,
        createdAt: 0,
        updatedAt: 0,
        zIndex: 0,
        locked: false,
        style,
        meta,
    };
}

export function makeStroke(points: StrokePoint[], id = nextId('stroke')): StrokeAnnotation {
    return { ...base(id), type: 'stroke', geometry: { points } };
}

/** A stroke whose bounding box is exactly the given rectangle. */
export function strokeCovering(box: BoundingBox, id?: string): StrokeAnnotation {
    return makeStroke(
        [
            { x: box.x, y: box.y },
            { x: box.x + box.width, y: box.y + box.height },
        ],
        id,
    );
}

export function makeShape(boundingBox: BoundingBox, id = nextId('shape')): ShapeAnnotation {
    return {
        ...base(id),
        type: 'shape',
        shapeType: 'rectangle',
        geometry: { boundingBox },
    };
}

export function idsOf(annotations: Annotation[]): string[] {
    return annotations.map((a) => a.id).sort();
}
