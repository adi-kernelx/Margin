// Core annotation data models

export type AnnotationType =
    | 'stroke'      // Freehand drawing
    | 'highlight'   // Text/freehand highlight
    | 'text'        // Text box
    | 'shape'       // Rectangle, arrow, etc.
    | 'image'       // Image annotation
    | 'math';       // Math LaTeX annotation

export interface AnnotationStyle {
    color: string;           // Hex or rgba
    opacity: number;         // 0-1
    width?: number;          // Stroke width
    blendMode?: string;      // For highlights: 'multiply'
    fontSize?: number;       // For text
    fontFamily?: string;
    bold?: boolean;         // For text
    italic?: boolean;       // For text
    underline?: boolean;    // For text
    backgroundColor?: string; // For text (rgba or 'transparent')
}

export interface AnnotationMeta {
    tool: string;            // Tool that created it
    isTemporary?: boolean;   // For preview before save
    strokeSmoothness?: number;
    compressionLevel?: number;
}

export interface BaseAnnotation {
    id: string;                    // UUID
    type: AnnotationType;
    pageNum: number;
    createdAt: number;
    updatedAt: number;
    author?: string;
    zIndex: number;
    locked: boolean;
    style: AnnotationStyle;
    meta: AnnotationMeta;
}

// Stroke (Pencil/Pen) Annotation
export interface StrokePoint {
    x: number;                 // Normalized to page dimensions (0-1)
    y: number;
    pressure?: number;         // 0-1 if available
    timestamp?: number;        // For velocity calculation
}

export interface StrokeAnnotation extends BaseAnnotation {
    type: 'stroke';
    geometry: {
        points: StrokePoint[];   // Ordered array
        smoothed?: boolean;
        compressed?: boolean;
    };
}

// Highlight Annotation
export interface TextHighlightRect {
    x: number;
    y: number;
    width: number;
    height: number;
    textRunId?: string;  // Reference to text layer element
}

export interface HighlightAnnotation extends BaseAnnotation {
    type: 'highlight';
    geometry: {
        mode: 'freehand' | 'text-aware';
        // For freehand
        path?: StrokePoint[];
        // For text-aware
        rects?: TextHighlightRect[];
    };
}

// Text Annotation
export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface TransformMatrix {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
}

export interface TextAnnotation extends BaseAnnotation {
    type: 'text';
    geometry: {
        boundingBox: BoundingBox;
        transform?: TransformMatrix;
    };
    content: string;
}

// Shape Annotation
export interface Point {
    x: number;
    y: number;
}

export interface ShapeAnnotation extends BaseAnnotation {
    type: 'shape';
    shapeType: 'rectangle' | 'ellipse' | 'arrow' | 'line';
    geometry: {
        boundingBox: BoundingBox;
        transform?: TransformMatrix;
        // For arrows
        startPoint?: Point;
        endPoint?: Point;
    };
}

// Image Annotation
export interface ImageAnnotation extends BaseAnnotation {
    type: 'image';
    geometry: {
        boundingBox: BoundingBox;
        transform?: TransformMatrix;
    };
    imageData: string; // Base64 or URL
}

// Math Annotation
export interface MathAnnotation extends BaseAnnotation {
    type: 'math';
    geometry: {
        boundingBox: BoundingBox;
        transform?: TransformMatrix;
    };
    content: string; // LaTeX
    svgDataUrl?: string; // Rendered SVG as Data URL
    displayMode: boolean;
}

// Union type for all annotations
export type Annotation =
    | StrokeAnnotation
    | HighlightAnnotation
    | TextAnnotation
    | ShapeAnnotation
    | ImageAnnotation
    | MathAnnotation;

// Helper type to get annotation by type
export type AnnotationByType<T extends AnnotationType> =
    T extends 'stroke' ? StrokeAnnotation :
    T extends 'highlight' ? HighlightAnnotation :
    T extends 'text' ? TextAnnotation :
    T extends 'shape' ? ShapeAnnotation :
    T extends 'image' ? ImageAnnotation :
    T extends 'math' ? MathAnnotation :
    never;

// Pointer state for unified handling
export interface PointerState {
    id: number;
    x: number;
    y: number;
    pressure: number;
    tiltX: number;
    tiltY: number;
    pointerType: string;
    timestamp: number;
}

// Operation types for undo/redo
export type OperationType =
    | 'add-annotation'
    | 'update-annotation'
    | 'delete-annotation'
    | 'split-stroke'
    | 'batch';

export interface Operation {
    id: string;
    docId: string;
    type: OperationType;
    timestamp: number;
    data: any;
    inverse?: Operation;
    applied?: boolean; // Runtime flag for undo/redo system
}
