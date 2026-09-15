import { useEffect, useRef, useState, useContext } from 'react';
import type { PageViewport } from 'pdfjs-dist';
import type { Annotation, StrokeAnnotation, HighlightAnnotation, TextAnnotation, ShapeAnnotation, ImageAnnotation, MathAnnotation, BoundingBox, TransformMatrix } from '@/lib/annotations/models';
import { UnifiedPointerHandler } from '@/lib/annotations/pointer-handler';
import { BaseTool } from '@/lib/tools/base-tool';
import { PencilTool } from '@/lib/tools/pencil-tool';
import { HighlighterTool } from '@/lib/tools/highlighter-tool';
import { EraserTool } from '@/lib/tools/eraser-tool';
import { TextTool } from '@/lib/tools/text-tool';
import { ImageTool } from '@/lib/tools/image-tool';
import { RectangleTool, ArrowTool } from '@/lib/tools/shape-tools';
import { MathTool } from '@/lib/tools/math-tool';
import katex from 'katex';
import { AnnotationQuadtree } from '@/lib/annotations/spatial-index';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { useAppStore as useGlobalStore } from '@/lib/store';
import { DocumentContext } from '@/contexts/DocumentContext';
import { denormalizePoint, normalizePoint } from '@/lib/rendering/stroke-smoother';
import { cn } from '@/lib/utils';
import { FloatingFormatToolbar } from './FloatingFormatToolbar';
import { renderInkOffscreen, supportsOffscreenInk } from '@/lib/workers/ink-render-worker-manager';

const CANVAS_EXPANSION_RATIO = 1.05;
const CANVAS_OFFSET_RATIO = 0.025;

// Matrix helpers for hit testing
const createPixelTransform = (t: TransformMatrix, w: number, h: number) => {
    return {
        a: t.a,
        b: t.b,
        c: t.c,
        d: t.d,
        e: t.e * w,
        f: t.f * h
    };
};

const invertMatrix = (m: TransformMatrix) => {
    const det = m.a * m.d - m.b * m.c;
    if (Math.abs(det) < 1e-6) return { a: 1, b: 0, c: 0, d: 1, e: -m.e, f: -m.f };
    return {
        a: m.d / det,
        b: -m.b / det,
        c: -m.c / det,
        d: m.a / det,
        e: (m.c * m.f - m.d * m.e) / det,
        f: (m.b * m.e - m.a * m.f) / det
    };
};

const applyToPoint = (m: TransformMatrix, p: { x: number; y: number }) => {
    return {
        x: m.a * p.x + m.c * p.y + m.e,
        y: m.b * p.x + m.d * p.y + m.f
    };
};

interface AnnotationCanvasProps {
    pageNum: number;
    viewport: PageViewport;
    annotations: Annotation[];
    onSave: (annotation: Annotation) => void;
    onDelete?: (id: string) => void;
    onErase?: (deletedIds: string[], created: Annotation[]) => void;
    textLayerRef?: React.RefObject<HTMLDivElement>;
    onImageUpload?: (file: File) => void;
}

export function AnnotationCanvas({
    pageNum,
    viewport,
    annotations,
    onSave,
    onDelete,
    onErase,
    textLayerRef,
    onImageUpload
}: AnnotationCanvasProps) {
    const inkCanvasRef = useRef<HTMLCanvasElement>(null); // Layer 2 - committed strokes/highlights
    const canvasRef = useRef<HTMLCanvasElement>(null); // Layer 2.1 - text/math and interaction target
    const imageCanvasRef = useRef<HTMLCanvasElement>(null); // Layer 3 - Images & shapes
    const previewCanvasRef = useRef<HTMLCanvasElement>(null); // Layer 2.5 - Preview
    const predictionCanvasRef = useRef<HTMLCanvasElement>(null); // Disposable latency-compensation layer
    const containerRef = useRef<HTMLDivElement>(null);
    const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);
    const [inkCtx, setInkCtx] = useState<CanvasRenderingContext2D | null>(null);
    const [imageCtx, setImageCtx] = useState<CanvasRenderingContext2D | null>(null);
    const [previewCtx, setPreviewCtx] = useState<CanvasRenderingContext2D | null>(null);
    const [predictionCtx, setPredictionCtx] = useState<CanvasRenderingContext2D | null>(null);
    const toolRef = useRef<BaseTool | null>(null);
    const pointerHandlerRef = useRef<UnifiedPointerHandler | null>(null);
    const quadtreeRef = useRef<AnnotationQuadtree | null>(null);
    const annotationsRef = useRef<Annotation[]>(annotations); // Track latest annotations for callbacks
    const predictionDirtyRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
    const inkRenderGenerationRef = useRef(0);

    // Text input overlay state
    const [textInputState, setTextInputState] = useState<{
        visible: boolean;
        x: number;
        y: number;
        width: number;
        height: number;
        id?: string; // For editing existing annotations
        initialText?: string;
    } | null>(null);
    const textInputRef = useRef<HTMLTextAreaElement | null>(null);
    const textBoxRef = useRef<HTMLDivElement | null>(null);
    const isDraggingRef = useRef(false);
    const isResizingRef = useRef(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0, annotationX: 0, annotationY: 0 });
    const lastImageClickRef = useRef<{ x: number; y: number } | null>(null);
    // State for awaiting image placement after upload

    // Selection state
    const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
    const [isMovingAnnotation, setIsMovingAnnotation] = useState(false);
    const [isResizingAnnotation, setIsResizingAnnotation] = useState(false);
    const [resizeHandle, setResizeHandle] = useState<string | null>(null);
    const [transientAnnotation, setTransientAnnotation] = useState<(ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation) | null>(null);
    const [isHoveringAnnotation, setIsHoveringAnnotation] = useState(false);

    const docStore = useContext(DocumentContext);

    // Helper to get current state imperatively (replaces useAppStore.getState())
    const getActiveState = () => {
        return docStore ? docStore.getState() : useGlobalStore.getState();
    };

    const {
        annotationMode,
        isDarkMode,
        highlighterMode,
        highlighterColor,
        highlighterOpacity,
        highlighterWidth,
        eraserMode,
        pencilColor,
        pencilWidth,
        rectangleColor,
        rectangleWidth,
        arrowColor,
        arrowWidth,
        textColor,
        textBackgroundColor,
        textFontSize,
        textFontFamily,
        textBold,
        textItalic,
        textUnderline,
        selectionMode,
        setSelectionMode,
        awaitingImagePlacement,
        setAwaitingImagePlacement,
        textSubscript,
        textSuperscript,

        setAnnotationMode,
        awaitingMathPlacement,
        setAwaitingMathPlacement,
        setEditingMathAnnotation,
        setMathModalOpen
    } = useDocumentStore();

    // Determine if annotation layer should capture pointer events
    // In 'select' mode, allow text selection by disabling pointer events on annotation layer
    // Also disable for text-aware highlighter to allow text selection on underlying layer
    const isTextAware = annotationMode === 'highlighter' && highlighterMode === 'text-aware';
    const isAnnotationMode = annotationMode !== null && annotationMode !== 'select' && !isTextAware;

    // Determine selection behavior based on selection mode
    const isSelectMode = annotationMode === 'select' || annotationMode === null;
    const shouldAllowTextSelection = isSelectMode && selectionMode === 'text';
    const shouldAllowAnnotationSelection = isSelectMode && selectionMode === 'annotations';
    const shouldAllowTextBoxSelection = isSelectMode && selectionMode === 'text-annotation';

    // In text mode, disable annotation selection; in annotations mode, disable text selection
    // In text mode, disable annotation selection; in annotations mode, disable text selection
    const shouldEnableAnnotationPointerEvents = isAnnotationMode || shouldAllowAnnotationSelection || shouldAllowTextBoxSelection || isHoveringAnnotation;

    // Determine if Text Layer should be interactive
    const shouldEnableTextLayer = shouldAllowTextSelection || isTextAware;

    // Layer z-ordering and pointer control
    // Layer 1: text layer (handled via textLayerRef styles)
    // Layer 2: strokes/highlights/text (no shapes)
    // Layer 3: images + shapes
    const annotationCanvasZ = 2;
    const imageCanvasZ = awaitingImagePlacement ? 5 : ((annotationMode === 'image' || annotationMode === 'math' || annotationMode === 'rectangle' || annotationMode === 'arrow' || shouldAllowAnnotationSelection || isHoveringAnnotation) ? 3 : 1);
    const textLayerZ = (shouldEnableTextLayer && !isHoveringAnnotation) ? 4 : 1;

    // Keep PDF text layer interactive when in text selection mode

    useEffect(() => {
        const textLayer = textLayerRef?.current;
        if (!textLayer) return;
        textLayer.style.pointerEvents = shouldEnableTextLayer ? 'auto' : 'none';
        textLayer.style.zIndex = `${textLayerZ}`;
    }, [textLayerRef, shouldEnableTextLayer, textLayerZ]);

    // Initialize canvas and context (only on mount or viewport size change)
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        const inkCanvas = inkCanvasRef.current;
        const inkContext = inkCanvas?.getContext('2d');
        if (!inkContext) return;

        const previewCanvas = previewCanvasRef.current;
        const previewContext = previewCanvas?.getContext('2d');
        if (!previewContext) return;

        const predictionCanvas = predictionCanvasRef.current;
        const predictionContext = predictionCanvas?.getContext('2d');
        if (!predictionContext) return;

        const imageCanvas = imageCanvasRef.current;
        const imageContext = imageCanvas?.getContext('2d');
        if (!imageContext) return;

        // Set canvas size to match PDF page dimensions + 20% expansion
        const dpr = window.devicePixelRatio || 1;
        const pageWidth = viewport.width;
        const pageHeight = viewport.height;


        const expansionRatio = CANVAS_EXPANSION_RATIO;
        const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
        const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;

        const canvasWidth = pageWidth * expansionRatio;
        const canvasHeight = pageHeight * expansionRatio;

        const updateCanvas = (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => {
            if (canvas.width !== canvasWidth * dpr || canvas.height !== canvasHeight * dpr) {
                canvas.width = canvasWidth * dpr;
                canvas.height = canvasHeight * dpr;
                canvas.style.width = `${canvasWidth}px`;
                canvas.style.height = `${canvasHeight}px`;

                // Reset transform and scale context for HiDPI + Offset
                context.setTransform(1, 0, 0, 1, 0, 0);
                context.scale(dpr, dpr);
                context.translate(offsetLeft, offsetTop);
            }
        };

        if (canvas && context) updateCanvas(canvas, context);
        if (inkCanvas && inkContext) updateCanvas(inkCanvas, inkContext);
        if (previewCanvas && previewContext) updateCanvas(previewCanvas, previewContext);
        if (predictionCanvas && predictionContext) updateCanvas(predictionCanvas, predictionContext);
        if (imageCanvas && imageContext) updateCanvas(imageCanvas, imageContext);

        setCtx(context);
        setInkCtx(inkContext);
        setPreviewCtx(previewContext);
        setPredictionCtx(predictionContext);
        setImageCtx(imageContext);
    }, [viewport.width, viewport.height]);

    // Initialize Quadtree
    useEffect(() => {
        if (!quadtreeRef.current) {
            // Expand Quadtree bounds to match the expanded canvas
            // This allows indexing annotations in the margins
            quadtreeRef.current = new AnnotationQuadtree({
                x: -CANVAS_OFFSET_RATIO,
                y: -CANVAS_OFFSET_RATIO,
                width: CANVAS_EXPANSION_RATIO,
                height: CANVAS_EXPANSION_RATIO
            });
        }
        quadtreeRef.current.rebuild(annotations.filter(a => a.pageNum === pageNum));

        // Also update tool's quadtree reference if it's an eraser
        if (toolRef.current instanceof EraserTool) {
            toolRef.current.updateQuadtree(quadtreeRef.current);
        }
    }, [annotations, pageNum]);

    // Keep annotationsRef in sync for use in callbacks
    useEffect(() => {
        annotationsRef.current = annotations;
    }, [annotations]);

    // Initialize tool
    useEffect(() => {
        if (!ctx) return;

        // Calculate dimensions for tools (Page Dimensions)
        const pageWidth = viewport.width;
        const pageHeight = viewport.height;

        // Create tool based on mode
        if (annotationMode === 'pencil') {
            const { pencilColor, pencilWidth } = getActiveState();
            toolRef.current = new PencilTool(
                pageWidth,
                pageHeight,
                pencilColor,
                pencilWidth,
                (annotation) => {
                    // Handle async stroke completion
                    annotation.pageNum = pageNum;
                    onSave(annotation);
                    redrawCanvas();
                }
            );
            toolRef.current.activate();
        } else if (annotationMode === 'highlighter') {
            const { highlighterMode, highlighterColor, highlighterOpacity, highlighterWidth } = getActiveState();
            toolRef.current = new HighlighterTool(
                pageWidth,
                pageHeight,
                highlighterColor,
                highlighterWidth,
                (annotation) => {
                    // Handle async stroke completion
                    annotation.pageNum = pageNum;
                    onSave(annotation);
                    redrawCanvas();
                },
                highlighterMode,
                highlighterOpacity,
                textLayerRef
            );
            toolRef.current.activate();
        } else if (annotationMode === 'eraser') {
            if (!quadtreeRef.current) {
                quadtreeRef.current = new AnnotationQuadtree({ x: 0, y: 0, width: 1, height: 1 });
                quadtreeRef.current.rebuild(annotations.filter(a => a.pageNum === pageNum));
            }

            const pageAnnotations = annotations.filter(a => a.pageNum === pageNum);

            toolRef.current = new EraserTool(
                pageWidth,
                pageHeight,
                quadtreeRef.current,
                (deletedIds: string[], createdAnnotations: Annotation[]) => {
                    createdAnnotations.forEach(annotation => { annotation.pageNum = pageNum; });
                    if (onErase) onErase(deletedIds, createdAnnotations);
                    else {
                        deletedIds.forEach(id => onDelete?.(id));
                        createdAnnotations.forEach(annotation => onSave(annotation));
                    }

                    // Request immediate redraw
                    requestAnimationFrame(() => {
                        redrawCanvas();

                        // Update quadtree for eraser tool using latest annotations from ref
                        if (quadtreeRef.current) {
                            const latestPageAnnotations = annotationsRef.current.filter(a => a.pageNum === pageNum);
                            quadtreeRef.current.rebuild(latestPageAnnotations);
                            if (toolRef.current instanceof EraserTool) {
                                toolRef.current.updateQuadtree(quadtreeRef.current);
                                toolRef.current.updateAnnotations(latestPageAnnotations);
                            }
                        }
                    });
                },
                eraserMode,
                pageAnnotations
            );
            toolRef.current.activate();
        } else if (annotationMode === 'text') {
            toolRef.current = new TextTool(
                pageWidth,
                pageHeight,
                {
                    onCreateTextInput: (x, y, width, height, onComplete) => {

                        const pageWidth = viewport.width;
                        const pageHeight = viewport.height;
                        const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
                        const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;

                        setTextInputState({
                            visible: true,
                            x: x + offsetLeft,
                            y: y + offsetTop,
                            width,
                            height
                        });
                        // Store callback
                        (toolRef.current as any)._onComplete = onComplete;
                    }
                },
                textColor,
                textFontSize,
                textFontFamily
            );
            toolRef.current.activate();
        } else if (annotationMode === 'rectangle') {
            const { rectangleColor, rectangleWidth } = getActiveState();
            toolRef.current = new RectangleTool(pageWidth, pageHeight, rectangleColor, rectangleWidth);
            toolRef.current.activate();
        } else if (annotationMode === 'arrow') {
            const { arrowColor, arrowWidth } = getActiveState();
            toolRef.current = new ArrowTool(pageWidth, pageHeight, arrowColor, arrowWidth);
            toolRef.current.activate();
        } else if (annotationMode === 'image') {
            toolRef.current = new ImageTool(
                pageWidth,
                pageHeight,
                {
                    onImagePaste: (x, y, imageData) => {
                        handleImagePaste(x, y, imageData);
                    },
                    onImageUpload: (x, y, imageData) => {
                        handleImageUpload(x, y, imageData);
                    }
                }
            );
            toolRef.current.activate();
        } else if (annotationMode === 'math') {
            toolRef.current = new MathTool(
                pageWidth,
                pageHeight,
                {
                    onPlace: (x, y) => {
                        if (awaitingMathPlacement) {
                            // Generate SVG Data URL for persistence
                            const mathml = katex.renderToString(awaitingMathPlacement.content, {
                                displayMode: awaitingMathPlacement.displayMode,
                                throwOnError: false,
                                output: 'mathml'
                            });

                            // SVG wrapper with foreignObject
                            // We use fixed bounds in the SVG to ensure it renders?
                            // Or viewbox?
                            // Let's use 200x100 default viewbox to match the tool defaults, or larger to allow scaling.
                            // Actually, just 100% is fine IF the img src load respects it.
                            const svgContent = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
                                <foreignObject width="100%" height="100%">
                                    <div xmlns="http://www.w3.org/1999/xhtml" style="
                                        font-size: ${textFontSize}px;
                                        color: ${textColor};
                                        width: 100%;
                                        height: 100%;
                                        display: flex;
                                        justify-content: center;
                                        align-items: center;
                                        overflow: visible;
                                    ">
                                        ${mathml}
                                    </div>
                                </foreignObject>
                            </svg>`;

                            const base64 = typeof window !== 'undefined' ? window.btoa(unescape(encodeURIComponent(svgContent))) : '';
                            const svgDataUrl = `data:image/svg+xml;base64,${base64}`;

                            const annotation = MathTool.createAnnotation(
                                x,
                                y,
                                awaitingMathPlacement.content,
                                awaitingMathPlacement.displayMode,
                                pageWidth,
                                pageHeight,
                                { fontSize: textFontSize, color: textColor, svgDataUrl }
                            );
                            annotation.pageNum = pageNum;
                            onSave(annotation);
                            setAwaitingMathPlacement(null);

                            // Select the new annotation AND switch to annotation selection mode
                            setAnnotationMode('select');
                            setSelectionMode('annotations'); // Force annotation selection mode so users can interact immediately
                            setSelectedAnnotationId(annotation.id);
                            redrawCanvas();
                        } else {
                            // Hit test for existing math annotations to select/edit
                            // We need to query the quadtree or existing annotations
                            const pageWidth = viewport.width;
                            const pageHeight = viewport.height;
                            const point = normalizePoint(x, y, pageWidth, pageHeight);

                            // Simple hit test against math annotations on this page
                            const pageAnnotations = annotations.filter(a => a.pageNum === pageNum && a.type === 'math');

                            // Find last one (topmost)
                            let found: MathAnnotation | null = null;
                            for (let i = pageAnnotations.length - 1; i >= 0; i--) {
                                const a = pageAnnotations[i] as MathAnnotation;
                                if (a.geometry?.boundingBox) {
                                    const bbox = a.geometry.boundingBox;
                                    if (point.x >= bbox.x && point.x <= bbox.x + bbox.width &&
                                        point.y >= bbox.y && point.y <= bbox.y + bbox.height) {
                                        found = a;
                                        break;
                                    }
                                }
                            }

                            if (found) {
                                setAnnotationMode('select');
                                setSelectionMode('annotations');
                                setSelectedAnnotationId(found.id);
                                // If double click logic handles edit, single click just selects.
                                // But if user wants to edit with Tool active?
                                // Usually tool active -> single click selects, double click edits.
                                // But Layer 2 captures clicks.
                                // We might need to detect double-click HERE in onPlace?
                                // MathTool doesn't distinguish single/double.
                                // We'll rely on the mode switch allowing the global dblclick handler to work.
                            }
                        }
                    }
                }
            );
            toolRef.current.activate();
        } else {
            if (toolRef.current) {
                toolRef.current.deactivate();
                toolRef.current = null;
            }
            // Close text input if switching away from text tool
            if (textInputState?.visible) {
                setTextInputState(null);
            }
        }

        // Update canvas cursor
        if (canvasRef.current && toolRef.current) {
            canvasRef.current.style.cursor = toolRef.current.getCursor();
        } else if (canvasRef.current) {
            canvasRef.current.style.cursor = 'default';
        }
    }, [annotationMode, ctx, viewport, isDarkMode, onDelete, annotations, pageNum, awaitingMathPlacement, textColor, textFontSize]);

    // Update tool settings when they change
    useEffect(() => {
        if (annotationMode === 'highlighter' && toolRef.current instanceof HighlighterTool) {
            toolRef.current.setMode(highlighterMode);
            toolRef.current.setColor(highlighterColor);
            toolRef.current.setOpacity(highlighterOpacity);
            toolRef.current.setStrokeWidth(highlighterWidth);
        } else if (annotationMode === 'eraser' && toolRef.current instanceof EraserTool) {
            toolRef.current.setMode(eraserMode);
            const pageAnnotations = annotations.filter(a => a.pageNum === pageNum);
            toolRef.current.updateAnnotations(pageAnnotations);
        } else if (annotationMode === 'pencil' && toolRef.current instanceof PencilTool) {
            toolRef.current.setColor(pencilColor);
            toolRef.current.setStrokeWidth(pencilWidth);
        } else if (annotationMode === 'rectangle' && toolRef.current instanceof RectangleTool) {
            toolRef.current.setColor(rectangleColor);
            toolRef.current.setStrokeWidth(rectangleWidth);
        } else if (annotationMode === 'text' && toolRef.current instanceof TextTool) {
            toolRef.current.setColor(textColor);
            toolRef.current.setFontSize(textFontSize);
            toolRef.current.setFontFamily(textFontFamily);
        } else if (annotationMode === 'arrow' && toolRef.current instanceof ArrowTool) {
            toolRef.current.setColor(arrowColor);
            toolRef.current.setStrokeWidth(arrowWidth);
        }
    }, [annotationMode, highlighterMode, highlighterColor, highlighterOpacity, highlighterWidth, eraserMode, textColor, textFontSize, textFontFamily, pencilColor, pencilWidth, rectangleColor, rectangleWidth, arrowColor, arrowWidth, annotations, pageNum]);

    // Handle double-click to edit text annotations
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;



        const handleDoubleClick = (e: MouseEvent) => {
            // Only handle if not in text tool mode (to avoid conflicts)
            if (annotationMode === 'text') return;

            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Check if we clicked on a text annotation
            const pageWidth = viewport.width;
            const pageHeight = viewport.height;
            const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
            const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;

            // Adjust click coordinates to Page Space
            const pageX = x - offsetLeft;
            const pageY = y - offsetTop;

            const pageAnnotations = annotations.filter(a => a.pageNum === pageNum && a.type === 'text');
            for (const annotation of pageAnnotations) {
                const textAnnotation = annotation as TextAnnotation;
                const bbox = textAnnotation.geometry.boundingBox;
                const normX = bbox.x * pageWidth;
                const normY = bbox.y * pageHeight;
                const normWidth = bbox.width * pageWidth;
                const normHeight = bbox.height * pageHeight;

                if (pageX >= normX && pageX <= normX + normWidth && pageY >= normY && pageY <= normY + normHeight) {
                    // Open text input for editing
                    setTextInputState({
                        visible: true,
                        x: normX + offsetLeft,
                        y: normY + offsetTop,
                        width: normWidth,
                        height: normHeight,
                        id: textAnnotation.id,
                        initialText: textAnnotation.content
                    });
                    setAnnotationMode('text');
                    setAnnotationMode('text');
                    break;
                }
            }

            // Check math annotations
            const mathAnnotations = annotations.filter(a => a.pageNum === pageNum && a.type === 'math');
            for (const annotation of mathAnnotations) {
                const mathAnnotation = annotation as MathAnnotation;
                const bbox = mathAnnotation.geometry.boundingBox;
                const normX = bbox.x * pageWidth;
                const normY = bbox.y * pageHeight;
                const normWidth = bbox.width * pageWidth;
                const normHeight = bbox.height * pageHeight;

                if (pageX >= normX && pageX <= normX + normWidth && pageY >= normY && pageY <= normY + normHeight) {
                    setEditingMathAnnotation({
                        id: mathAnnotation.id,
                        content: mathAnnotation.content,
                        displayMode: mathAnnotation.displayMode
                    });
                    break;
                }
            }
        };

        canvas.addEventListener('dblclick', handleDoubleClick);

        return () => {
            canvas.removeEventListener('dblclick', handleDoubleClick);
            canvas.removeEventListener('dblclick', handleDoubleClick);
        };
    }, [annotations, pageNum, viewport, annotationMode]);

    // Helpers for transform-aware geometry (Layer 3)
    const getBaseBox = (annotation: ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation): BoundingBox => {
        return (annotation.geometry as any).baseBox || annotation.geometry.boundingBox;
    };

    const getTransform = (annotation: ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation): TransformMatrix => {
        const t = annotation.geometry.transform as any;
        if (!t) {
            return {
                a: 1,
                b: 0,
                c: 0,
                d: 1,
                e: annotation.geometry.boundingBox.x,
                f: annotation.geometry.boundingBox.y,
            };
        }
        // Handle legacy format {x, y, scaleX, scaleY}
        if (typeof t.e === 'undefined' && typeof t.scaleX === 'number') {
            return {
                a: t.scaleX,
                b: 0,
                c: 0,
                d: t.scaleY,
                e: t.x,
                f: t.y
            };
        }
        return t;
    };

    // Draw selection overlay (outline + resize handles)
    const drawSelectionOverlay = (
        ctx: CanvasRenderingContext2D,
        annotation: ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation,
        pageWidth: number,
        pageHeight: number
    ) => {
        const base = getBaseBox(annotation);
        const t = getTransform(annotation);

        ctx.save();

        // Apply transform
        ctx.transform(t.a, t.b, t.c, t.d, t.e * pageWidth, t.f * pageHeight);

        const width = base.width * pageWidth;
        const height = base.height * pageHeight;

        // Draw selection outline
        ctx.strokeStyle = '#007bff';
        // Adjust line width to be consistent despite scaling
        const avgScale = Math.sqrt(t.a * t.a + t.b * t.b);
        ctx.lineWidth = 2 / avgScale;
        ctx.setLineDash([4 / avgScale, 4 / avgScale]);
        ctx.strokeRect(0, 0, width, height);
        ctx.setLineDash([]);

        // Rotation handle (top center + offset)
        if (annotation.type !== 'math' && annotation.type !== 'text') {
            const rotationHandleDistance = 20 / avgScale; // keeping it visually consistent
            const rotateX = width / 2;
            const rotateY = -rotationHandleDistance;

            // Draw line to rotation handle
            ctx.beginPath();
            ctx.moveTo(width / 2, 0);
            ctx.lineTo(rotateX, rotateY);
            ctx.strokeStyle = '#007bff';
            ctx.stroke();

            // Draw rotation handle circle
            ctx.beginPath();
            ctx.arc(rotateX, rotateY, 5 / avgScale, 0, 2 * Math.PI);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.stroke();
        }

        // Draw resize handles
        const handleSize = 10 / avgScale;
        const halfHandle = handleSize / 2;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#007bff';
        ctx.lineWidth = 2 / avgScale;

        let handles = [
            { x: 0, y: 0 }, // nw
            { x: width, y: 0 }, // ne
            { x: 0, y: height }, // sw
            { x: width, y: height }, // se
            { x: width / 2, y: 0 }, // n
            { x: width / 2, y: height }, // s
            { x: 0, y: height / 2 }, // w
            { x: width, y: height / 2 } // e
        ];

        // For Math, only show bottom-right handle
        if (annotation.type === 'math') {
            handles = [{ x: width, y: height }];
        }

        handles.forEach(handle => {
            ctx.beginPath();
            ctx.arc(handle.x, handle.y, halfHandle, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        });

        ctx.restore();
    };

    // Redraw image canvas (Layer 3)
    const redrawImageCanvas = () => {
        if (!imageCtx || !imageCanvasRef.current) return;

        const pageWidth = viewport.width;
        const pageHeight = viewport.height;
        const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
        const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;
        const expansionRatio = CANVAS_EXPANSION_RATIO;

        // Clear image canvas (expanded)
        imageCtx.clearRect(
            -offsetLeft,
            -offsetTop,
            pageWidth * expansionRatio,
            pageHeight * expansionRatio
        );

        // Draw all image and shape annotations for this page (Layer 3)
        // Use ref to get latest annotations even when called from stale closures
        let pageAnnotations = annotationsRef.current.filter(a => a.pageNum === pageNum && (a.type === 'image' || a.type === 'shape'));

        // Apply transient update if exists
        if (transientAnnotation) {
            pageAnnotations = pageAnnotations.map(a =>
                a.id === transientAnnotation.id ? transientAnnotation : a
            );
        }

        // Draw shapes first, then images so images sit above shapes if overlapping
        // Draw annotations in z-order
        pageAnnotations.forEach(annotation => {
            if (annotation.type === 'shape') {
                drawShape(imageCtx, annotation as ShapeAnnotation, pageWidth, pageHeight);
            } else if (annotation.type === 'image') {
                const imgAnnotation = annotation as ImageAnnotation;
                const base = getBaseBox(imgAnnotation);
                const t = getTransform(imgAnnotation);

                const img = new Image();
                img.onload = () => {
                    if (imageCtx) {
                        imageCtx.save();
                        imageCtx.transform(t.a, t.b, t.c, t.d, t.e * pageWidth, t.f * pageHeight);
                        const width = base.width * pageWidth;
                        const height = base.height * pageHeight;
                        imageCtx.globalAlpha = imgAnnotation.style.opacity || 1;
                        imageCtx.drawImage(img, 0, 0, width, height);
                        imageCtx.restore();

                        // Re-draw selection overlay if this was the selected image to ensure it's on top?
                        // This simplistic async load might cause z-fighting with overlay but we keep it simple conformant to existing.
                        if (selectedAnnotationId === imgAnnotation.id) {
                            drawSelectionOverlay(imageCtx, imgAnnotation, pageWidth, pageHeight);
                        }
                    }
                };
                img.onerror = () => {
                    console.warn('Failed to load image:', imgAnnotation.id);
                };
                img.src = imgAnnotation.imageData;
            }
        });

        // Draw selection overlay for the selected annotation
        if (selectedAnnotationId) {
            const selectedAnnotation = pageAnnotations.find(a => a.id === selectedAnnotationId);
            if (selectedAnnotation) {
                drawSelectionOverlay(imageCtx, selectedAnnotation as ImageAnnotation | ShapeAnnotation, pageWidth, pageHeight);
            }
        }
    };

    // Redraw entire canvas (Layer 2 & 3 wrapper)
    const redrawCanvas = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        // Calculate proper dimensions for rendering
        const pageWidth = viewport.width;
        const pageHeight = viewport.height;
        const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
        const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;
        const expansionRatio = CANVAS_EXPANSION_RATIO;

        const currentAnnotations = annotationsRef.current;
        const inkAnnotations = currentAnnotations.filter(
            (annotation): annotation is StrokeAnnotation | HighlightAnnotation =>
                annotation.pageNum === pageNum && (annotation.type === 'stroke' || annotation.type === 'highlight'),
        );
        const drawInkOnMainThread = () => {
            if (!inkCtx) return;
            inkCtx.clearRect(-offsetLeft, -offsetTop, pageWidth * expansionRatio, pageHeight * expansionRatio);
            for (const annotation of inkAnnotations.filter(item => item.type === 'highlight')) {
                drawHighlight(inkCtx, annotation, pageWidth, pageHeight);
            }
            for (const annotation of inkAnnotations.filter(item => item.type === 'stroke')) {
                drawStroke(inkCtx, annotation, pageWidth, pageHeight);
            }
        };

        if (inkCtx && supportsOffscreenInk()) {
            const generation = ++inkRenderGenerationRef.current;
            void renderInkOffscreen(inkAnnotations, pageWidth, pageHeight, window.devicePixelRatio || 1)
                .then(bitmap => {
                    if (generation !== inkRenderGenerationRef.current) {
                        bitmap.close();
                        return;
                    }
                    inkCtx.clearRect(-offsetLeft, -offsetTop, pageWidth * expansionRatio, pageHeight * expansionRatio);
                    inkCtx.drawImage(bitmap, 0, 0, pageWidth, pageHeight);
                    bitmap.close();
                })
                .catch(drawInkOnMainThread);
        } else {
            drawInkOnMainThread();
        }

        // Clear expanded canvas (accounting for translation)
        ctx.clearRect(
            -offsetLeft,
            -offsetTop,
            pageWidth * expansionRatio,
            pageHeight * expansionRatio
        );

        // Draw all saved annotations for this page (Layer 2 only: strokes/highlights/text/math)
        // Use ref to get latest annotations even when called from stale closures
        let pageAnnotations = currentAnnotations.filter(a => a.pageNum === pageNum && (a.type === 'text' || a.type === 'math'));

        if (transientAnnotation) {
            pageAnnotations = pageAnnotations.map(a =>
                a.id === transientAnnotation.id ? transientAnnotation : a
            );
        }

        const sortedAnnotations = pageAnnotations;

        for (const annotation of sortedAnnotations) {
            if (annotation.type === 'text') {
                drawText(ctx, annotation as TextAnnotation, pageWidth, pageHeight);
            } else if (annotation.type === 'math') {
                drawMath(ctx, annotation as MathAnnotation, pageWidth, pageHeight);
            }
        }

        // Draw selection overlay for math/text annotations (since they are on Layer 2)
        if (selectedAnnotationId) {
            const selectedL2 = sortedAnnotations.find(a => a.id === selectedAnnotationId && (a.type === 'math' || a.type === 'text'));
            if (selectedL2) {
                drawSelectionOverlay(ctx, selectedL2 as MathAnnotation | TextAnnotation, pageWidth, pageHeight);
            }
        }

        // Also update layer 3
        redrawImageCanvas();
    };



    // Hit testing for images and shapes AND math AND text overlay
    const rotatableAnnotations = annotations
        .filter(a => a.pageNum === pageNum && (a.type === 'image' || a.type === 'shape' || a.type === 'math' || a.type === 'text'))
        .reverse();

    // Helper: distance from point to line segment
    const distanceToLineSegment = (
        px: number, py: number,
        x1: number, y1: number,
        x2: number, y2: number
    ): number => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length2 = dx * dx + dy * dy;

        if (length2 === 0) {
            return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
        }

        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / length2));
        const projX = x1 + t * dx;
        const projY = y1 + t * dy;
        return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
    };

    const findAnnotationAtPoint = (x: number, y: number): Annotation | null => {
        const pageWidth = viewport.width;
        const pageHeight = viewport.height;
        const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
        const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;

        // Adjust to page coordinates
        const pageX = x - offsetLeft;
        const pageY = y - offsetTop;

        // Check images, shapes, math (Layer 3 & 2) with rotation support
        // Iterate in reverse render order (top checks first)
        for (let i = rotatableAnnotations.length - 1; i >= 0; i--) {
            const annotation = rotatableAnnotations[i];
            const t = getTransform(annotation as ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation);
            const base = getBaseBox(annotation as ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation);

            const pxT = createPixelTransform(t, pageWidth, pageHeight);
            const invT = invertMatrix(pxT);
            const localP = applyToPoint(invT, { x: pageX, y: pageY });

            const width = base.width * pageWidth;
            const height = base.height * pageHeight;

            const shapeType = annotation.type === 'shape' ? (annotation as ShapeAnnotation).shapeType : 'rect';

            if (shapeType === 'arrow') {
                const start = (annotation as any).geometry.startPoint;
                const end = (annotation as any).geometry.endPoint;
                if (start && end) {
                    // start/end are now Local Normalized (0..1)
                    // width/height are the Box dimensions in pixels
                    const sx = start.x * width;
                    const sy = start.y * height;
                    const ex = end.x * width;
                    const ey = end.y * height;

                    // localP is the point in Local Space (pixels)
                    const dist = distanceToLineSegment(localP.x, localP.y, sx, sy, ex, ey);
                    if (dist < 10) return annotation;
                }
            } else {
                if (localP.x >= 0 && localP.x <= width &&
                    localP.y >= 0 && localP.y <= height) {
                    return annotation;
                }
            }
        }

        // Check text annotations (Layer 2)
        const textAnnos = annotations.filter(a => a.pageNum === pageNum && a.type === 'text');
        for (const annotation of textAnnos) {
            const bbox = (annotation as TextAnnotation).geometry.boundingBox;
            const nx = pageX / pageWidth;
            const ny = pageY / pageHeight;
            if (nx >= bbox.x && nx <= bbox.x + bbox.width && ny >= bbox.y && ny <= bbox.y + bbox.height) {
                return annotation;
            }
        }
        return null;
    };

    // Smart Hover Logic to enable selection in Text Mode
    useEffect(() => {
        if (!isSelectMode || selectionMode !== 'text') {
            if (isHoveringAnnotation) setIsHoveringAnnotation(false);
            return;
        }

        const container = containerRef.current;
        if (!container) return;

        const handleMouseMove = (e: MouseEvent) => {
            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Only check if mouse is within container bounds
            if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
                if (isHoveringAnnotation) setIsHoveringAnnotation(false);
                return;
            }

            const annotation = findAnnotationAtPoint(x, y);

            const isOverSelectable = annotation && (annotation.type === 'math' || annotation.type === 'image' || annotation.type === 'shape');

            if (!!isOverSelectable !== isHoveringAnnotation) {
                setIsHoveringAnnotation(!!isOverSelectable);
            }
        };

        // Use document-level event to capture mouse moves even when pointer-events are disabled on container
        document.addEventListener('mousemove', handleMouseMove);
        return () => document.removeEventListener('mousemove', handleMouseMove);
    }, [isSelectMode, selectionMode, pageNum, annotations, isHoveringAnnotation, viewport]);



    const getRotationHandle = (x: number, y: number, annotation: ImageAnnotation | ShapeAnnotation | TextAnnotation) => {
        const t = getTransform(annotation);
        const base = getBaseBox(annotation);

        const pageWidth = viewport.width;
        const pageHeight = viewport.height;
        const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
        const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;

        // Adjust to page coordinates
        const pageX = x - offsetLeft;
        const pageY = y - offsetTop;

        const pxT = createPixelTransform(t, pageWidth, pageHeight);
        const invT = invertMatrix(pxT);
        const localP = applyToPoint(invT, { x: pageX, y: pageY });

        const width = base.width * pageWidth;

        const avgScale = (Math.abs(t.a) + Math.abs(t.d)) / 2;
        const handleX = width / 2;
        const handleY = -20 / avgScale;

        const dist = Math.sqrt((localP.x - handleX) ** 2 + (localP.y - handleY) ** 2);

        // Threshold in Unscaled Space (approx 10 screen pixels)
        if (dist <= 10 / avgScale) return 'rotate';

        return null;
    };

    const getResizeHandle = (x: number, y: number, annotation: ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation) => {
        const t = getTransform(annotation);
        const base = getBaseBox(annotation);

        const pageWidth = viewport.width;
        const pageHeight = viewport.height;
        const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
        const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;

        // Adjust to page coordinates
        const pageX = x - offsetLeft;
        const pageY = y - offsetTop;

        const pxT = createPixelTransform(t, pageWidth, pageHeight);
        const invT = invertMatrix(pxT);
        const localP = applyToPoint(invT, { x: pageX, y: pageY });

        const width = base.width * pageWidth;
        const height = base.height * pageHeight;

        const avgScale = (Math.abs(t.a) + Math.abs(t.d)) / 2;
        const threshold = 10 / avgScale;

        const handles = {
            nw: { x: 0, y: 0 },
            ne: { x: width, y: 0 },
            sw: { x: 0, y: height },
            se: { x: width, y: height },
            n: { x: width / 2, y: 0 },
            s: { x: width / 2, y: height },
            w: { x: 0, y: height / 2 },
            e: { x: width, y: height / 2 }
        };

        let activeHandles = Object.entries(handles);

        if (annotation.type === 'math') {
            activeHandles = [['se', handles.se]];
        }

        for (const [key, handle] of activeHandles) {
            const dist = Math.sqrt((localP.x - handle.x) ** 2 + (localP.y - handle.y) ** 2);
            if (dist <= threshold) return key;
        }

        return null;
    };

    // Helper: Get CSS cursor for resize handle direction
    const getResizeCursor = (handle: string): string => {
        switch (handle) {
            case 'nw': case 'se': return 'nwse-resize';
            case 'ne': case 'sw': return 'nesw-resize';
            case 'n': case 's': return 'ns-resize';
            case 'e': case 'w': return 'ew-resize';
            default: return 'default';
        }
    };

    // Update cursor based on hover state over selected annotation
    useEffect(() => {
        const imageCanvas = imageCanvasRef.current;
        if (!imageCanvas) return;

        const handlePointerMove = (e: PointerEvent) => {
            if (awaitingMathPlacement) {
                imageCanvas.style.cursor = 'crosshair';
                return;
            }

            // Don't change cursor while actively dragging/resizing
            if (isMovingAnnotation || isResizingAnnotation) return;

            const rect = imageCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // If we have a selected annotation, check for handle or body hover
            if (selectedAnnotationId && shouldAllowAnnotationSelection) {
                const selected = annotations.find(a => a.id === selectedAnnotationId);
                if (selected && (selected.type === 'image' || selected.type === 'shape' || selected.type === 'math')) {
                    const annotation = selected as ImageAnnotation | ShapeAnnotation | MathAnnotation;

                    // Check if hovering over a resize handle
                    const handle = getResizeHandle(x, y, annotation);
                    if (handle) {
                        imageCanvas.style.cursor = getResizeCursor(handle);
                        return;
                    }

                    // Check if hovering over rotation handle
                    if (annotation.type !== 'math') {
                        const rotHandle = getRotationHandle(x, y, annotation);
                        if (rotHandle) {
                            imageCanvas.style.cursor = 'grab'; // or specific cursor
                            return;
                        }
                    }

                    // Check if hovering over the body of the selected annotation
                    const hoveredAnnotation = findAnnotationAtPoint(x, y);
                    if (hoveredAnnotation && hoveredAnnotation.id === selectedAnnotationId) {
                        imageCanvas.style.cursor = 'move';
                        return;
                    }
                }
            }

            // Check if hovering over any selectable annotation (pointer cursor)
            if (shouldAllowAnnotationSelection) {
                const hoveredAnnotation = findAnnotationAtPoint(x, y);
                if (hoveredAnnotation && (hoveredAnnotation.type === 'image' || hoveredAnnotation.type === 'shape' || hoveredAnnotation.type === 'math')) {
                    imageCanvas.style.cursor = 'pointer';
                    return;
                }
            }

            // Default cursor
            imageCanvas.style.cursor = 'default';
        };

        imageCanvas.addEventListener('pointermove', handlePointerMove);

        return () => {
            imageCanvas.removeEventListener('pointermove', handlePointerMove);
        };
    }, [selectedAnnotationId, annotations, isMovingAnnotation, isResizingAnnotation, shouldAllowAnnotationSelection, viewport, awaitingMathPlacement]);


    // Handle image paste from clipboard
    const handleImagePaste = (x: number, y: number, imageData: string) => {
        if (!toolRef.current || !(toolRef.current instanceof ImageTool)) return;

        const img = new Image();
        img.onload = () => {
            if (!toolRef.current || !(toolRef.current instanceof ImageTool)) return;
            
            const originalWidth = img.width;
            const originalHeight = img.height;
            
            // Set a reasonable maximum width for initial placement so it doesn't cover the whole page
            const maxWidth = 300;
            let finalWidth = originalWidth;
            let finalHeight = originalHeight;
            
            if (originalWidth > maxWidth) {
                const ratio = maxWidth / originalWidth;
                finalWidth = maxWidth;
                finalHeight = originalHeight * ratio;
            }

            const annotation = toolRef.current.createAnnotation(
                x,
                y,
                finalWidth,
                finalHeight,
                imageData
            );

            annotation.pageNum = pageNum;
            onSave(annotation);
            redrawImageCanvas();
        };
        img.onerror = () => {
            console.error('Failed to load pasted image to determine dimensions');
        };
        img.src = imageData;
    };

    // Set up pointer handler
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !ctx) return;

        const handler = new UnifiedPointerHandler(canvas);

        handler.onPointerDown((state) => {
            const pageWidth = viewport.width;
            const pageHeight = viewport.height;
            const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
            const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;

            const pageState = {
                ...state,
                x: state.x - offsetLeft,
                y: state.y - offsetTop
            };

            // Don't create new text input if we're editing an existing one
            if (textInputState?.visible && annotationMode === 'text') return;

            // Handle image placement after upload
            if (annotationMode === 'image' && awaitingImagePlacement) {
                // Place image on the current page regardless of upload page
                handleImagePaste(pageState.x, pageState.y, awaitingImagePlacement.imageData);
                setAwaitingImagePlacement(null); // Clear awaiting state
                return;
            }

            // Shapes are handled on Layer 3; this layer no longer manages shape/image selection

            // Store click position for image tool (for Ctrl+V paste)
            if (annotationMode === 'image') {
                lastImageClickRef.current = { x: pageState.x, y: pageState.y };
                // Don't call tool's onPointerDown for image tool - just store position
                return;
            }

            // Handle Text Creation or Selection
            if (annotationMode === 'text' || selectionMode === 'text-annotation') {
                const clickedAnnotation = findAnnotationAtPoint(state.x, state.y);

                // If we clicked an existing text annotation
                if (clickedAnnotation && clickedAnnotation.type === 'text') {
                    const textAnno = clickedAnnotation as TextAnnotation;

                    const bbox = textAnno.geometry.boundingBox;
                    const normX = bbox.x * pageWidth;
                    const normY = bbox.y * pageHeight;
                    const normWidth = bbox.width * pageWidth;
                    const normHeight = bbox.height * pageHeight;

                    // Edit mode
                    setTextInputState({
                        visible: true,
                        x: normX + offsetLeft,
                        y: normY + offsetTop,
                        width: normWidth,
                        height: normHeight,
                        id: textAnno.id,
                        initialText: textAnno.content
                    });

                    // Don't continue to tool handling (avoid creating new one)
                    return;
                }
            }

            if (!toolRef.current) return;
            // Draw to preview context if available, or fall back to main context
            // Usually pointer down starts a shape/stroke which is transient until pointer up
            toolRef.current.onPointerDown(pageState, previewCtx || ctx);
        });

        handler.onPointerMove((state) => {
            // Handle moving annotation - Moved to Layer 3 handler for images/shapes
            // Layer 2 only handles strokes/highlights/text which currently don't use this move logic
            // or will be implemented separately if needed.

            if (!toolRef.current) return;

            // Clear preview layer primarily (some tools might need underlying data, but generally no)
            // Clear entire preview canvas
            if (previewCtx && previewCanvasRef.current && !(toolRef.current instanceof PencilTool)) {
                const pageWidth = viewport.width;
                const pageHeight = viewport.height;
                const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
                const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;

                // Clear starting from negative offset to cover full expanded area
                previewCtx.clearRect(
                    -offsetLeft,
                    -offsetTop,
                    pageWidth * CANVAS_EXPANSION_RATIO,
                    pageHeight * CANVAS_EXPANSION_RATIO
                );
            }

            // Draw preview - this will handle cursor rendering for eraser
            if (previewCtx) {
                // Keep state.x (Canvas Coords) for finding elements?
                // Visual feedback usually needs Page Coords if the context is translated?
                // Yes, previewCtx is translated in useEffect.
                // So we should pass Page Coords.
                const pageWidth = viewport.width;
                const pageHeight = viewport.height;
                const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
                const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;

                const pageState = {
                    ...state,
                    x: state.x - offsetLeft,
                    y: state.y - offsetTop
                };
                toolRef.current.onPointerMove(pageState, previewCtx);

                // Prediction is isolated from the real live stroke so reconciliation
                // never requires repainting committed or already captured ink.
                if (predictionCtx && predictionCanvasRef.current) {
                    const previousDirty = predictionDirtyRef.current;
                    if (previousDirty) predictionCtx.clearRect(
                        previousDirty.x,
                        previousDirty.y,
                        previousDirty.width,
                        previousDirty.height,
                    );
                    if (toolRef.current instanceof PencilTool) {
                        toolRef.current.renderPrediction(predictionCtx);
                        predictionDirtyRef.current = toolRef.current.getPredictionBounds();
                    }
                }
            }
        });

        handler.onPointerUp((state) => {
            // End moving or resizing
            if (isMovingAnnotation || isResizingAnnotation) {
                setIsMovingAnnotation(false);
                setIsResizingAnnotation(false);
                setResizeHandle(null);
                return;
            }

            if (!toolRef.current) return;

            // For final draw/commit, we use the tool's standard return
            // But for rendering during drag, we used previewCtx.
            // Some tools might return null and handle drawing themselves, but standard ones return annotation.

            // Clear preview
            if (previewCtx && previewCanvasRef.current) {
                const pageWidth = viewport.width;
                const pageHeight = viewport.height;
                const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
                const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;

                previewCtx.clearRect(
                    -offsetLeft,
                    -offsetTop,
                    pageWidth * CANVAS_EXPANSION_RATIO,
                    pageHeight * CANVAS_EXPANSION_RATIO
                );
                const predictionDirty = predictionDirtyRef.current;
                if (predictionDirty) predictionCtx?.clearRect(
                    predictionDirty.x,
                    predictionDirty.y,
                    predictionDirty.width,
                    predictionDirty.height,
                );
                predictionDirtyRef.current = null;
            }

            const pageWidth = viewport.width;
            const pageHeight = viewport.height;
            const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
            const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;

            const pageState = {
                ...state,
                x: state.x - offsetLeft,
                y: state.y - offsetTop
            };

            const annotation = toolRef.current.onPointerUp(pageState, ctx);

            if (annotation) {
                // Set correct page number
                annotation.pageNum = pageNum;
                onSave(annotation);

                // Redraw canvas with new annotation
                redrawCanvas();
            }
        });

        pointerHandlerRef.current = handler;

        return () => {
            handler.detach();
        };
    }, [ctx, pageNum, onSave, annotationMode, awaitingImagePlacement, handleImagePaste, textInputState, previewCtx, predictionCtx, annotations, viewport, isMovingAnnotation, isResizingAnnotation, selectedAnnotationId, resizeHandle, selectionMode, shouldAllowAnnotationSelection, shouldAllowTextSelection]);



    // Handle image upload
    const handleImageUpload = (x: number, y: number, imageData: string) => {
        handleImagePaste(x, y, imageData);
    };

    // Handle generic paste event for images
    useEffect(() => {
        if (annotationMode !== 'image') return;

        const handlePaste = (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items) return;

            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    e.preventDefault();
                    const blob = items[i].getAsFile();
                    if (blob) {
                        const reader = new FileReader();
                        reader.onload = () => {
                            const base64 = reader.result as string;
                            // Enter placement mode instead of auto-pasting
                            setAwaitingImagePlacement({
                                imageData: base64
                            });
                        };
                        reader.readAsDataURL(blob);
                    }
                    return;
                }
            }
        };

        window.addEventListener('paste', handlePaste);
        return () => {
            window.removeEventListener('paste', handlePaste);
        };
    }, [annotationMode, setAwaitingImagePlacement]);

    // Handle image file upload from file picker
    useEffect(() => {
        if (!onImageUpload) return;

        const handleFileUpload = async (file: File) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result as string;
                // Store image data and enter awaiting placement mode
                // Don't place automatically - wait for user to click on current page
                setAwaitingImagePlacement({
                    imageData: base64
                });
            };
            reader.readAsDataURL(file);
        };

        // Store handler globally so ImageOptions can call it
        window.__handleImageFileUpload = handleFileUpload;

        return () => {
            delete window.__handleImageFileUpload;
        };
    }, [onImageUpload, pageNum]);

    // Deselect annotations when changing tools
    useEffect(() => {
        setSelectedAnnotationId(null);
    }, [annotationMode]);

    // Redraw canvas when selection changes so overlay appears
    useEffect(() => {
        redrawCanvas();
    }, [selectedAnnotationId]);

    // Clear awaiting placement when switching tools (allow page switching)
    useEffect(() => {
        if (annotationMode !== 'image') {
            setAwaitingImagePlacement(null);
        }
    }, [annotationMode]);

    // Handle Delete key to remove selected annotation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotationId) {
                if (textInputState?.visible) return;

                if (onDelete) {
                    onDelete(selectedAnnotationId);
                    setSelectedAnnotationId(null);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedAnnotationId, textInputState, onDelete]);

    // Handle pointer events on image canvas for selection, move, and resize
    useEffect(() => {
        const imageCanvas = imageCanvasRef.current;
        if (!imageCanvas) return;

        let isDragging = false;
        let isResizing = false;
        let currentHandle: string | null = null;
        let draggedAnnotation: (ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation) | null = null;
        let startX = 0;
        let startY = 0;
        let startAnnotationX = 0;
        let startAnnotationY = 0;
        let startWidth = 0;
        let startHeight = 0;
        let isRotating = false;
        let startAngle = 0;
        let rotationCenter = { x: 0, y: 0 };
        // For arrows: store initial startPoint and endPoint
        let initialStartPoint: { x: number; y: number } | null = null;
        let initialEndPoint: { x: number; y: number } | null = null;

        const handlePointerDown = (e: PointerEvent) => {
            const rect = imageCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Handle image placement after upload
            if (awaitingImagePlacement) {
                const pageWidth = viewport.width;
                const pageHeight = viewport.height;
                const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
                const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;

                handleImagePaste(x - offsetLeft, y - offsetTop, awaitingImagePlacement.imageData);
                setAwaitingImagePlacement(null);
                return;
            }

            // Handle selection, move, and resize for images and shapes
            if (!shouldAllowAnnotationSelection && !isHoveringAnnotation && annotationMode !== 'math') return;

            const pageWidth = viewport.width;
            const pageHeight = viewport.height;
            const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
            const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;


            // Check if clicking on a resize handle of the currently selected annotation
            if (selectedAnnotationId) {
                const selected = annotations.find(a => a.id === selectedAnnotationId);
                if (selected && (selected.type === 'image' || selected.type === 'shape' || selected.type === 'math' || selected.type === 'text')) {
                    const annotation = selected as ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation;

                    // Check for rotation handle first
                    if (annotation.type !== 'math') {
                        const rotationHandle = getRotationHandle(x, y, annotation);
                        if (rotationHandle) {
                            isRotating = true;
                            draggedAnnotation = annotation;
                            startX = x;
                            startY = y;

                            const t = getTransform(annotation);
                            const base = getBaseBox(annotation);
                            // Center is defined by Transform (e, f) + Size/2 rotated?
                            // Or just visual center of box?
                            // If t handles translation (e,f), center is (e + width/2, f + height/2)?
                            // Center of rotation for "rotateAroundCenter" logic assumed cx, cy.
                            // Let's use the current center of the AABB or OBB.
                            // Ideally center is (t.e + base.width*t.a/2, t.f + base.height*t.d/2)?
                            // If t is [a,b,c,d,e,f], center is apply(t, {x: base.width/2, y: base.height/2}).

                            // Let's assume standard center point of the UNROTATED box, transformed.
                            const localCenter = { x: base.width / 2, y: base.height / 2 };
                            // apply t to localCenter
                            // Manual apply:
                            const cxNorm = t.a * localCenter.x + t.c * localCenter.y + t.e;
                            const cyNorm = t.b * localCenter.x + t.d * localCenter.y + t.f;

                            const cx = cxNorm * pageWidth;
                            const cy = cyNorm * pageHeight;

                            rotationCenter = { x: cx, y: cy };
                            // Check: y is Canvas Coord. cy is Page Coord scaled.
                            // But cxNorm is Page Normalized (0..1).
                            // So cx is Page Pixels.
                            // y is Canvas Pixels.
                            // We need to compare in same space.
                            // Adjust x,y to Page Space for angle calc.
                            const pageX = x - offsetLeft;
                            const pageY = y - offsetTop;

                            startAngle = Math.atan2(pageY - cy, pageX - cx);

                            imageCanvas.setPointerCapture(e.pointerId);
                            e.preventDefault();
                            return;
                        }

                    }

                    const handle = getResizeHandle(x, y, annotation);
                    if (handle) {
                        // Start resizing
                        isResizing = true;
                        currentHandle = handle;
                        draggedAnnotation = annotation;
                        startX = x;
                        startY = y;

                        const t = getTransform(annotation);
                        const base = getBaseBox(annotation);
                        startAnnotationX = t.e * pageWidth;
                        startAnnotationY = t.f * pageHeight;
                        startWidth = base.width * pageWidth;
                        startHeight = base.height * pageHeight;

                        // Store initial arrow points if it's an arrow
                        if (annotation.type === 'shape' && (annotation as ShapeAnnotation).shapeType === 'arrow') {
                            const shapeAnno = annotation as ShapeAnnotation;
                            initialStartPoint = shapeAnno.geometry.startPoint ? { ...shapeAnno.geometry.startPoint } : null;
                            initialEndPoint = shapeAnno.geometry.endPoint ? { ...shapeAnno.geometry.endPoint } : null;
                        }

                        imageCanvas.setPointerCapture(e.pointerId);
                        setIsResizingAnnotation(true);
                        setResizeHandle(handle);
                        e.preventDefault();
                        return;
                    }
                }
            }

            // Check if clicking on any annotation
            const clickedAnnotation = findAnnotationAtPoint(x, y);
            if (clickedAnnotation && (clickedAnnotation.type === 'image' || clickedAnnotation.type === 'shape' || clickedAnnotation.type === 'math' || clickedAnnotation.type === 'text')) {
                const annotation = clickedAnnotation as ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation;

                // Select it
                setSelectedAnnotationId(annotation.id);

                // Start moving
                isDragging = true;
                draggedAnnotation = annotation;
                startX = x;
                startY = y;

                const t = getTransform(annotation);
                const base = getBaseBox(annotation);
                startAnnotationX = t.e * pageWidth;
                startAnnotationY = t.f * pageHeight;
                startWidth = base.width * pageWidth;
                startHeight = base.height * pageHeight;

                // Store initial arrow points if it's an arrow
                if (annotation.type === 'shape' && (annotation as ShapeAnnotation).shapeType === 'arrow') {
                    const shapeAnno = annotation as ShapeAnnotation;
                    initialStartPoint = shapeAnno.geometry.startPoint ? { ...shapeAnno.geometry.startPoint } : null;
                    initialEndPoint = shapeAnno.geometry.endPoint ? { ...shapeAnno.geometry.endPoint } : null;
                }

                imageCanvas.setPointerCapture(e.pointerId);
                imageCanvas.style.cursor = 'grabbing';
                setIsMovingAnnotation(true);
                e.preventDefault();
                return;
            }

            // Clicked on empty space - deselect
            setSelectedAnnotationId(null);

            // If in Math mode and clicked empty space, handle placement or new creation
            if (annotationMode === 'math') {
                if (awaitingMathPlacement && toolRef.current) {
                    // Trigger placement immediately on down
                    const pageWidth = viewport.width;
                    const pageHeight = viewport.height;
                    const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
                    const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;

                    toolRef.current.onPointerUp({
                        x: x - offsetLeft,
                        y: y - offsetTop,
                        pressure: 0.5,
                        pointerType: e.pointerType,
                        id: e.pointerId,
                        tiltX: 0,
                        tiltY: 0,
                        timestamp: Date.now()
                    }, imageCanvas.getContext('2d')!);
                } else {
                    // No pending placement -> Open modal to start new equation
                    setEditingMathAnnotation(null);
                    setMathModalOpen(true);
                }
            }
        };

        const handlePointerMove = (e: PointerEvent) => {
            if (!draggedAnnotation) return;

            const rect = imageCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const pageWidth = viewport.width;
            const pageHeight = viewport.height;
            const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
            const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;

            const deltaX = x - startX;
            const deltaY = y - startY;

            // Normalized delta
            const normalizedDeltaX = deltaX / pageWidth;
            const normalizedDeltaY = deltaY / pageHeight;

            if (isRotating) {
                const pageX = x - offsetLeft;
                const pageY = y - offsetTop;
                const currentAngle = Math.atan2(pageY - rotationCenter.y, pageX - rotationCenter.x);
                const angleStep = currentAngle - startAngle;
                startAngle = currentAngle;

                // Helper to multiply matrices (T(cx,cy) * R(angle) * T(-cx,-cy) * M)
                const rotateAroundCenter = (m: TransformMatrix, angle: number, cx: number, cy: number) => {
                    const c = Math.cos(angle);
                    const s = Math.sin(angle);
                    const rc = {
                        a: c, c: -s, e: cx - c * cx + s * cy,
                        b: s, d: c, f: cy - s * cx - c * cy
                    };
                    return {
                        a: rc.a * m.a + rc.c * m.b,
                        b: rc.b * m.a + rc.d * m.b,
                        c: rc.a * m.c + rc.c * m.d,
                        d: rc.b * m.c + rc.d * m.d,
                        e: rc.a * m.e + rc.c * m.f + rc.e,
                        f: rc.b * m.e + rc.d * m.f + rc.f
                    };
                };

                const cxNorm = rotationCenter.x / pageWidth;
                const cyNorm = rotationCenter.y / pageHeight;
                const currentT = getTransform(draggedAnnotation);
                const updatedT = rotateAroundCenter(currentT, angleStep, cxNorm, cyNorm);

                const updatedGeometry = {
                    ...draggedAnnotation.geometry,
                    transform: updatedT
                };

                const updatedAnnotation = {
                    ...draggedAnnotation,
                    geometry: updatedGeometry,
                    updatedAt: Date.now()
                };

                draggedAnnotation = updatedAnnotation as ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation;
                setTransientAnnotation(updatedAnnotation as ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation);
            }

            if (isDragging) {
                // Moving - update translation
                const newE = (startAnnotationX + deltaX) / pageWidth;
                const newF = (startAnnotationY + deltaY) / pageHeight;

                const currentT = getTransform(draggedAnnotation);
                const updatedT = {
                    ...currentT,
                    e: Math.max(0, Math.min(1, newE)), // simplistic clamp? 
                    // Better verify whole box logic but loose clamp is safer for now
                    f: Math.max(0, Math.min(1, newF))
                };

                // Sync BBox (legacy/fallback)
                const updatedBBox = {
                    ...draggedAnnotation.geometry.boundingBox,
                    x: updatedT.e,
                    y: updatedT.f
                };

                // Build updated geometry
                const updatedGeometry: any = {
                    ...draggedAnnotation.geometry,
                    transform: updatedT,
                    boundingBox: updatedBBox
                };

                // For arrows, also update startPoint and endPoint (Global Coords)
                // Note: If arrow uses transform 't', updating 't' handles visuals.
                // But previous 'arrow' logic updated points?
                // If I update 't.e/f', the arrow moves.
                // Should I ALSO update points?
                // If I update points AND t, I double move?
                // Currently 'drawShape' used 't'.
                // So updating 't' moves the arrow.
                // So I do NOT need to update points now!
                // Except hit testing used points?
                // My hit testing uses points if available logic.
                // If I leave points as is, but 't' moves them...
                // Hit testing needs to check TRANSFOMRED points.
                // My hit testing logic for arrow was "distanceToLine" using global points.
                // If global points are stale (not updated), hit testing fails on moved arrow!

                // So: Either update points AND keep t Identity?
                // OR Update t AND hit test using inverse t?
                // My hit testing uses local check which implies inverse t?
                // Wait. Arrow hit test logic:
                // "if (start && end) ... distanceToLineSegment".
                // It does NOT use 't' currently (lines 687+ in Step 414).
                // It uses "gsx = start.x * cssWidth".

                // If I rely on 't' for drawing, I MUST update points to stay consistent OR update hit testing to use t.
                // Updating hit testing for arrow is hard (line segment in local space).
                // Easier: Update points during drag (keep t constant/identity for Arrow?).
                // BUT I just unified Drawing to use 't' for Arrow!
                // If I use 't' for Arrow, I must rely on 't'.

                // So I MUST update hit testing for Arrow to use 't'.
                // I did that? 
                // In `findAnnotationAtPoint`:
                // "If arrow ... const dist = distanceToLineSegment(x, y, gsx...)"
                // It uses gsx (global start x).
                // This IGNORES 't'.

                // So if I move Arrow using 't', hit testing breaks.

                // Solution: For now, for Arrows, update POINTS during drag, and KEEP T constant (translation).
                // Actually, if 't' handles translation, why update points?
                // Because hit/draw logic is split.

                // Let's revert Draw Logic for Arrow to use "Points + Identity T"?
                // No, Draw Logic is "Points transformed by T".
                // If I update T, Draw is correct. Hit is wrong.

                // If I update Points, and keep T constant (Identity). Draw is correct. Hit is correct.
                // So for Arrow, I should NOT update T.e/f?
                // I should update Points.

                if (draggedAnnotation.type === 'shape' && (draggedAnnotation as ShapeAnnotation).shapeType === 'arrow') {
                    if (initialStartPoint && initialEndPoint) {
                        const dx = normalizedDeltaX;
                        const dy = normalizedDeltaY;
                        updatedGeometry.startPoint = {
                            x: initialStartPoint.x + dx,
                            y: initialStartPoint.y + dy
                        };
                        updatedGeometry.endPoint = {
                            x: initialEndPoint.x + dx,
                            y: initialEndPoint.y + dy
                        };
                        // Keep T as is (don't update e/f for arrow if we update points)
                        // But T was updated above for generic case.
                        // Override it?
                        updatedGeometry.transform = draggedAnnotation.geometry.transform;
                        // Reset transform to original allowing points to drive position
                    }
                }

                const updatedAnnotation = {
                    ...draggedAnnotation,
                    geometry: updatedGeometry,
                    updatedAt: Date.now()
                };

                draggedAnnotation = updatedAnnotation as ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation;
                setTransientAnnotation(updatedAnnotation as ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation);
            }

            if (isResizing && currentHandle) {
                // Resizing logic - tricky for rotated.
                // Use fallback AABB resize logic for now.
                // It will resize the BASE DIMENSIONS.
                // Visual result: Rotated box grows along its axes.

                let newScreenX = startAnnotationX;
                let newScreenY = startAnnotationY;
                let newScreenWidth = startWidth;
                let newScreenHeight = startHeight;

                if (currentHandle.includes('w')) {
                    const newLeft = startAnnotationX + deltaX;
                    newScreenWidth = startWidth - deltaX;
                    if (newScreenWidth > 10) newScreenX = newLeft;
                    else newScreenWidth = 10;
                }
                if (currentHandle.includes('e')) {
                    newScreenWidth = Math.max(10, startWidth + deltaX);
                }
                if (currentHandle.includes('n')) {
                    const newTop = startAnnotationY + deltaY;
                    newScreenHeight = startHeight - deltaY;
                    if (newScreenHeight > 10) newScreenY = newTop;
                    else newScreenHeight = 10;
                }
                if (currentHandle.includes('s')) {
                    newScreenHeight = Math.max(10, startHeight + deltaY);
                }

                // ... shift/alt logic omitted for brevity, add if needed or relying on base...

                const finalW = newScreenWidth / pageWidth;
                const finalH = newScreenHeight / pageHeight;
                // Position updates (e, f) need to reflect X/Y updates if Top/Left changed.
                // startAnnotationX was t.e.
                // newScreenX is t.e'.
                const finalE = newScreenX / pageWidth;
                const finalF = newScreenY / pageHeight;

                const currentT = getTransform(draggedAnnotation);
                const updatedT = {
                    ...currentT,
                    e: finalE,
                    f: finalF,
                    // If we resized, did we change Scale (a,d) or BaseWidth?
                    // getTransformedBBox used width*t.a.
                    // Here we changed 'width' (screen width) which represents 'base.width * t.a'.
                    // If we keep t.a constant, we must update base.width.
                    // If we keep base.width constant, we update t.a.
                    // Updating base.width is safer for SVG/Image content preservation?
                    // Actually for Shapes/Images, updating dimensions (boundingBox width/height) is standard.
                };

                const updatedGeometry: any = {
                    ...draggedAnnotation.geometry,
                    transform: updatedT,
                    boundingBox: {
                        ...draggedAnnotation.geometry.boundingBox,

                        // If t.a != 1, finalW should be adjusted?
                        // startWidth = base.width * cssWidth.
                        // newScreenWidth = startWidth + delta.
                        // finalW = newScreenWidth / cssWidth.
                        // So finalW = base.width_new.
                        // So we update base width directly.
                        // And transform logic (t.a, etc) applies to new base width.
                        // This is correct behavior for "resize along local axes".

                        // BUT `finalE` logic assumes translation. 
                        // If rotated, changing X (Screen X) might not map to `e` directly if `e` is local translation?
                        // `t` [a,b,c,d,e,f] usually `e, f` IS global translation.
                        // So updating `e, f` works.

                        // Wait. If rotated 45 deg.
                        // Dragging "Western" handle (Left side of unrotated box).
                        // Should move the "Left" side of the rotated box?
                        // My `currentHandle` logic logic assumes Axis Aligned Handles.
                        // `getResizeHandle` returns handles based on Local Points (0,0 etc).
                        // So 'w' handle is Local Left.
                        // dragging 'w' handle moves Local Left.
                        // In Local space, moving 'w' changes width and shifts origin (if we pivot right).

                        // But `deltaX` is global screen delta.
                        // To resize consistently in rotated space, we need `deltaLocal`.
                        // `deltaLocal = apply(invalidT, deltaGlobal)`.

                        // This complexity is high for "Fixing Rotated Selection Handles".
                        // I will stick to "Update Width/Height" (Visual scaling)
                        // And position logic might be slightly off for rotated objects resizing, 
                        // but standard "Move/Rotate" is the user goal. Resizing is bonus.
                        width: finalW,
                        height: finalH
                    }
                };

                const updatedAnnotation = {
                    ...draggedAnnotation,
                    geometry: updatedGeometry,
                    updatedAt: Date.now()
                };

                draggedAnnotation = updatedAnnotation as ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation;
                setTransientAnnotation(updatedAnnotation as ImageAnnotation | ShapeAnnotation | MathAnnotation | TextAnnotation);
            }
        };

        const handlePointerUp = (e: PointerEvent) => {
            if (draggedAnnotation && (isDragging || isResizing || isRotating)) {
                // Save the final state
                onSave(draggedAnnotation);

                // Redraw canvases
                redrawImageCanvas();
            }

            // Reset state
            isDragging = false;
            isResizing = false;
            isRotating = false;
            currentHandle = null;
            draggedAnnotation = null;
            initialStartPoint = null;
            initialEndPoint = null;
            setIsMovingAnnotation(false);
            setIsResizingAnnotation(false);
            setResizeHandle(null);
            setTransientAnnotation(null);

            try {
                imageCanvas.releasePointerCapture(e.pointerId);
            } catch (err) { /* ignore */ }
        };

        const handleDoubleClick = (e: MouseEvent) => {
            const rect = imageCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            if (shouldAllowAnnotationSelection || annotationMode === 'math' || isHoveringAnnotation) {
                const clicked = findAnnotationAtPoint(x, y);
                if (clicked && clicked.type === 'math') {
                    setEditingMathAnnotation(clicked as MathAnnotation);
                    setMathModalOpen(true);
                }
            }
        };

        imageCanvas.addEventListener('pointerdown', handlePointerDown);
        imageCanvas.addEventListener('pointermove', handlePointerMove);
        imageCanvas.addEventListener('pointerup', handlePointerUp);
        imageCanvas.addEventListener('pointercancel', handlePointerUp);
        imageCanvas.addEventListener('dblclick', handleDoubleClick);

        return () => {
            imageCanvas.removeEventListener('pointerdown', handlePointerDown);
            imageCanvas.removeEventListener('pointermove', handlePointerMove);
            imageCanvas.removeEventListener('pointerup', handlePointerUp);
            imageCanvas.removeEventListener('pointercancel', handlePointerUp);
            imageCanvas.removeEventListener('dblclick', handleDoubleClick);
        };
    }, [awaitingImagePlacement, pageNum, annotations, viewport, selectedAnnotationId, onSave, shouldAllowAnnotationSelection, annotationMode]);

    // Draw a stroke annotation
    const drawStroke = (
        ctx: CanvasRenderingContext2D,
        annotation: StrokeAnnotation,
        pageWidth: number,
        pageHeight: number
    ) => {
        const points = annotation.geometry.points;
        const curves = annotation.geometry.beziers;
        if (points.length < 2 && !curves?.length) return;

        ctx.save();
        ctx.strokeStyle = annotation.style.color;
        ctx.lineWidth = annotation.style.width || 2;
        ctx.globalAlpha = annotation.style.opacity;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();

        const firstPoint = curves?.[0]?.start || points[0];
        const firstDenorm = denormalizePoint(firstPoint.x, firstPoint.y, pageWidth, pageHeight);
        ctx.moveTo(firstDenorm.x, firstDenorm.y);

        if (curves?.length) {
            for (const curve of curves) {
                ctx.bezierCurveTo(
                    curve.control1.x * pageWidth,
                    curve.control1.y * pageHeight,
                    curve.control2.x * pageWidth,
                    curve.control2.y * pageHeight,
                    curve.end.x * pageWidth,
                    curve.end.y * pageHeight,
                );
            }
        } else {
            for (let i = 1; i < points.length; i++) {
                const denorm = denormalizePoint(points[i].x, points[i].y, pageWidth, pageHeight);
                ctx.lineTo(denorm.x, denorm.y);
            }
        }

        ctx.stroke();
        ctx.restore();
    };

    // Draw a highlight annotation
    const drawHighlight = (
        ctx: CanvasRenderingContext2D,
        annotation: HighlightAnnotation,
        pageWidth: number,
        pageHeight: number
    ) => {
        ctx.save();

        // Use multiply blend mode to preserve text visibility
        ctx.globalCompositeOperation = (annotation.style.blendMode as GlobalCompositeOperation) || 'multiply';

        // Convert hex color to rgba with opacity
        const hex = annotation.style.color;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const alpha = annotation.style.opacity || 0.25;
        const rgba = `rgba(${r}, ${g}, ${b}, ${alpha})`;

        ctx.fillStyle = rgba;

        if (annotation.geometry.mode === 'freehand' && annotation.geometry.path) {
            const points = annotation.geometry.path;
            if (points.length < 2) {
                ctx.restore();
                return;
            }

            ctx.strokeStyle = rgba;
            ctx.lineWidth = annotation.style.width || 12;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // Draw as filled path for better highlighter appearance
            ctx.beginPath();

            // Denormalize and draw first point
            const firstDenorm = denormalizePoint(points[0].x, points[0].y, pageWidth, pageHeight);
            ctx.moveTo(firstDenorm.x, firstDenorm.y);

            // Draw remaining points
            for (let i = 1; i < points.length; i++) {
                const denorm = denormalizePoint(points[i].x, points[i].y, pageWidth, pageHeight);
                ctx.lineTo(denorm.x, denorm.y);
            }

            // Stroke with thick line
            ctx.stroke();

            // Also fill with lower opacity for better coverage
            ctx.globalAlpha = alpha * 0.6; // Even more transparent fill
            ctx.fill();
        } else if (annotation.geometry.mode === 'text-aware' && annotation.geometry.rects) {
            // Draw text-aware highlights as rectangles
            annotation.geometry.rects.forEach((rect) => {
                const x = rect.x * pageWidth;
                const y = rect.y * pageHeight;
                const width = rect.width * pageWidth;
                const height = rect.height * pageHeight;

                ctx.fillRect(x, y, width, height);
            });
        }

        ctx.restore();
    };

    // Draw a text annotation
    const drawText = (
        ctx: CanvasRenderingContext2D,
        annotation: TextAnnotation,
        pageWidth: number,
        pageHeight: number
    ) => {
        const bbox = annotation.geometry.boundingBox;
        const x = bbox.x * pageWidth;
        const y = bbox.y * pageHeight;
        const width = bbox.width * pageWidth;
        const height = bbox.height * pageHeight;

        ctx.save();

        // Draw background if not transparent
        if (annotation.style.backgroundColor && annotation.style.backgroundColor !== 'transparent') {
            ctx.fillStyle = annotation.style.backgroundColor;
            ctx.fillRect(x, y, width, height);
        }

        // Set text style
        const fontSize = annotation.style.fontSize || 16;
        const fontFamily = annotation.style.fontFamily || 'Arial';
        const bold = annotation.style.bold ? 'bold ' : '';
        const italic = annotation.style.italic ? 'italic ' : '';
        ctx.font = `${bold}${italic}${fontSize}px ${fontFamily} `;
        ctx.fillStyle = annotation.style.color;
        ctx.globalAlpha = annotation.style.opacity || 1;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';

        // Word wrap text allowing for hard breaks
        const paragraphs = annotation.content.split('\n');
        const lines: string[] = [];

        paragraphs.forEach(paragraph => {
            const words = paragraph.split(' ');
            let currentLine = '';

            for (const word of words) {
                const testLine = currentLine + (currentLine ? ' ' : '') + word;
                const metrics = ctx.measureText(testLine);

                if (metrics.width > width && currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    currentLine = testLine;
                }
            }
            lines.push(currentLine);
        });

        // Draw each line
        const lineHeight = fontSize * 1.2;
        const underline = annotation.style.underline;
        lines.forEach((line, index) => {
            const lineY = y + index * lineHeight;
            ctx.fillText(line, x, lineY);

            // Draw underline if enabled
            if (underline) {
                const metrics = ctx.measureText(line);
                ctx.strokeStyle = annotation.style.color;
                ctx.lineWidth = Math.max(1, fontSize / 16);
                ctx.beginPath();
                ctx.moveTo(x, lineY + fontSize + 2);
                ctx.lineTo(x + metrics.width, lineY + fontSize + 2);
                ctx.stroke();
            }
        });

        ctx.restore();
    };

    // Draw math annotation
    const drawMath = (
        ctx: CanvasRenderingContext2D,
        annotation: MathAnnotation,
        pageWidth: number,
        pageHeight: number
    ) => {
        const bbox = annotation.geometry.boundingBox;
        const x = bbox.x * pageWidth;
        const y = bbox.y * pageHeight;
        const width = bbox.width * pageWidth;
        const height = bbox.height * pageHeight;

        // Draw background for debug/selection visibility (transparent usually)
        if (annotation.style.backgroundColor) {
            ctx.fillStyle = annotation.style.backgroundColor;
            ctx.fillRect(x, y, width, height);
        }

        // Cache key for this annotation state
        const cacheKey = `math_img_v2_${annotation.id}_${annotation.updatedAt}`;

        // Check global cache
        let img = (window as any)[cacheKey];

        if (!img) {
            if (annotation.svgDataUrl) {
                // Use stored SVG Data URL
                img = new Image();
                img.onload = () => {
                    redrawCanvas();
                };
                img.onerror = () => {
                    console.error("Failed to load math SVG image from data URL");
                    (img as any)._broken = true;
                };
                img.src = annotation.svgDataUrl;
                (window as any)[cacheKey] = img;
            } else {
                try {
                    // Legacy/Fallback: Render using MathML output on the fly
                    const mathml = katex.renderToString(annotation.content, {
                        displayMode: annotation.displayMode,
                        throwOnError: false,
                        output: 'mathml'
                    });

                    // Wrap in SVG foreignObject
                    const svgContent = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
                        <foreignObject width="100%" height="100%">
                            <div xmlns="http://www.w3.org/1999/xhtml" style="
                                font-size: ${annotation.style.fontSize || 16}px; 
                                color: ${annotation.style.color || 'black'}; 
                                width: 100%; 
                                height: 100%; 
                                display: flex; 
                                justify-content: center; 
                                align-items: center;
                                overflow: visible;
                            ">
                                <style>
                                    math { 
                                        color: ${annotation.style.color || 'black'}; 
                                        font-family: serif;
                                    }
                                </style>
                                ${mathml}
                            </div>
                        </foreignObject>
                    </svg>`;

                    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
                    const url = URL.createObjectURL(blob);

                    img = new Image();
                    img.onload = () => {
                        redrawCanvas();
                    };
                    img.onerror = () => {
                        console.error("Failed to load math SVG image");
                        (img as any)._broken = true;
                    };
                    img.src = url;
                    (window as any)[cacheKey] = img;
                } catch (e) {
                    console.error("Math render error", e);
                    return;
                }
            }
        }

        if (img && img.complete && !(img as any)._broken && img.naturalWidth > 0) {
            try {
                ctx.drawImage(img, x, y, width, height);
            } catch (e) {
                console.error("Error drawing math image to canvas", e);
                // Mark as broken so we don't try again
                (img as any)._broken = true;
            }
        }
    };

    // Draw a shape annotation
    const drawShape = (
        ctx: CanvasRenderingContext2D,
        annotation: ShapeAnnotation,
        pageWidth: number,
        pageHeight: number
    ) => {
        const base = getBaseBox(annotation);
        const t = getTransform(annotation);

        ctx.save();

        // Apply transform
        // Canvas transform order: a, b, c, d, e, f
        // Note: x and y in draw rect should be 0, 0 because translation is handled by e, f
        // Wait, t.e and t.f are normalized coordinates. We need to scale them to page dimensions?
        // Actually, e and f are normalized to [0,1].
        // But context setTransform takes pixels.
        // We can either:
        // 1. Scale context to match page dimensions (normalized -> pixel)
        // 2. Compute pixel transform.

        // Option 1 is easier for rendering logic overall, but might affect stroke width.
        // Let's stick to using setTransform with pixel values.
        // But our stored matrix is normalized.
        // Normalized: [x'] = [a c e] * [x]
        //             [y']   [b d f]   [y]
        //             [1 ]   [0 0 1]   [1]

        // We want Pixel coords.
        // Px = x' * W
        // Py = y' * H

        // This suggests we should transform the matrix to pixel space.
        // It's tricky with aspect ratio.
        // Let's rely on standard logic:
        // Translate to (e*W, f*H)
        // Rotate/Skew/Scale (using a,b,c,d but mixed with W/H?)

        // Actually, if we assume isotropic scale (square pixels), we can use:
        // ctx.setTransform(t.a, t.b, t.c, t.d, t.e * pageWidth, t.f * pageHeight);
        // BUT `t.a` affects X. `x_final` = `t.a * x_local + t.e`.
        // If local `width` is `base.width`, then `drawn_width` is `base.width * t.a`.
        // In pixels: `drawn_width_px` = `drawn_width * pageWidth`.
        // So `pixel_scale_x` = `t.a`.
        // BUT this assumes we draw in normalized coordinates?
        // If we use `ctx.strokeRect(0, 0, base.width * pageWidth, base.height * pageHeight)`,
        // We need the transform to NOT scale by pageWidth again?

        // Let's look at `getTransformedBBox`: `width: base.width * t.a`.
        // This implies t.a is the scale factor applied to the base width.

        ctx.transform(t.a, t.b, t.c, t.d, t.e * pageWidth, t.f * pageHeight);

        const width = base.width * pageWidth;
        const height = base.height * pageHeight;

        ctx.strokeStyle = annotation.style.color;
        ctx.lineWidth = (annotation.style.width || 2) / Math.max(t.a, t.d); // Adjust stroke for scale? Or keep generic?
        // Actually better to not scale stroke with object if possible, but context transform does.
        // Let's keep it simple.
        ctx.lineWidth = annotation.style.width || 2;
        ctx.globalAlpha = annotation.style.opacity;
        ctx.setLineDash([]);

        if (annotation.shapeType === 'rectangle') {
            ctx.strokeRect(0, 0, width, height);
        } else if (annotation.shapeType === 'arrow' || annotation.shapeType === 'line') {
            const startPoint = annotation.geometry.startPoint;
            const endPoint = annotation.geometry.endPoint;

            if (startPoint && endPoint) {
                // Points are now Local Normalized coordinates.
                // We draw in the Transformed Context (Local Space of the box).

                // Convert to pixels for drawing
                const sx = startPoint.x * width;
                const sy = startPoint.y * height;
                const ex = endPoint.x * width;
                const ey = endPoint.y * height;

                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(ex, ey);
                ctx.stroke();

                // Specific arrow head logic
                if (annotation.shapeType === 'arrow') {
                    const angle = Math.atan2(ey - sy, ex - sx);
                    const arrowLength = 15; // px
                    const arrowAngle = Math.PI / 6;

                    ctx.beginPath();
                    ctx.moveTo(ex, ey);
                    ctx.lineTo(
                        ex - arrowLength * Math.cos(angle - arrowAngle),
                        ey - arrowLength * Math.sin(angle - arrowAngle)
                    );
                    ctx.moveTo(ex, ey);
                    ctx.lineTo(
                        ex - arrowLength * Math.cos(angle + arrowAngle),
                        ey - arrowLength * Math.sin(angle + arrowAngle)
                    );
                    ctx.stroke();
                }
            }
        } else if (annotation.shapeType === 'ellipse') {
            const centerX = width / 2;
            const centerY = height / 2;
            const radiusX = width / 2;
            const radiusY = height / 2;

            ctx.beginPath();
            ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
            ctx.stroke();
        }

        ctx.restore();
    };

    // Draw selection indicators (outline + resize handles)


    // Redraw when annotations change
    useEffect(() => {
        redrawCanvas();
        redrawImageCanvas();
    }, [annotations, ctx, inkCtx, imageCtx, viewport, pageNum, transientAnnotation, selectedAnnotationId]);



    // Force redraw and update tool when dark mode changes
    useEffect(() => {
        if (toolRef.current && annotationMode === 'pencil') {
            const color = isDarkMode ? '#ffffff' : '#000000';
            (toolRef.current as PencilTool).setColor(color);
        } else if (toolRef.current && annotationMode === 'text') {
            const color = isDarkMode ? '#ffffff' : '#000000';
            (toolRef.current as TextTool).setColor(color);
        } else if (toolRef.current && annotationMode === 'rectangle') {
            const color = isDarkMode ? '#ffffff' : '#000000';
            (toolRef.current as RectangleTool).setColor(color);
        } else if (toolRef.current && annotationMode === 'arrow') {
            const color = isDarkMode ? '#ffffff' : '#000000';
            (toolRef.current as ArrowTool).setColor(color);
        }
    }, [isDarkMode, annotationMode]);

    // Handle text input submission
    const handleTextSubmit = (text: string) => {
        if (!textInputState || !toolRef.current || !(toolRef.current instanceof TextTool)) return;

        // Calculate dimensions
        const pageWidth = viewport.width;
        const pageHeight = viewport.height;
        const offsetLeft = pageWidth * CANVAS_OFFSET_RATIO;
        const offsetTop = pageHeight * CANVAS_OFFSET_RATIO;

        // textInputState.x/y includes offset (Canvas Coords).
        // We need Page Coords.
        const pageX = textInputState.x - offsetLeft;
        const pageY = textInputState.y - offsetTop;

        // If editing existing annotation, update it
        if (textInputState.id) {
            const existingAnnotation = annotations.find(a => a.id === textInputState.id && a.type === 'text');
            if (existingAnnotation) {
                const updated: TextAnnotation = {
                    ...existingAnnotation as TextAnnotation,
                    content: text,
                    updatedAt: Date.now(),
                    geometry: {
                        boundingBox: {
                            x: normalizePoint(pageX, pageY, pageWidth, pageHeight).x,
                            y: normalizePoint(pageX, pageY, pageWidth, pageHeight).y,
                            width: textInputState.width / pageWidth,
                            height: textInputState.height / pageHeight,
                        }
                    },
                    style: {
                        ...existingAnnotation.style,
                        color: textColor,
                        backgroundColor: textBackgroundColor,
                        fontSize: textFontSize,
                        fontFamily: textFontFamily,
                        bold: textBold,
                        italic: textItalic,
                        underline: textUnderline,
                    }
                };
                onSave(updated);
                setTextInputState(null);
                redrawCanvas();
                return;
            }
        }

        // Create new annotation
        if (!text.trim()) {
            setTextInputState(null);
            return;
        }

        const annotation = toolRef.current.createAnnotation(
            pageX,
            pageY,
            textInputState.width,
            textInputState.height,
            text
        );

        // Apply current style settings
        annotation.pageNum = pageNum;
        annotation.style = {
            ...annotation.style,
            color: textColor,
            backgroundColor: textBackgroundColor,
            fontSize: textFontSize,
            fontFamily: textFontFamily,
            bold: textBold,
            italic: textItalic,
            underline: textUnderline,
        };

        onSave(annotation);
        setTextInputState(null);
        redrawCanvas();
    };

    // Handle text input cancellation
    const handleTextCancel = () => {
        setTextInputState(null);
    };

    // Focus text input when it appears
    useEffect(() => {
        if (textInputState?.visible && textInputRef.current) {
            textInputRef.current.focus();
            if (textInputState.initialText) {
                textInputRef.current.value = textInputState.initialText;
            }
        }
    }, [textInputState]);

    // Handle text box dragging
    useEffect(() => {
        if (!textInputState?.visible || !textBoxRef.current) return;

        const box = textBoxRef.current;

        const handleMouseDown = (e: MouseEvent) => {
            // Don't start drag if clicking on textarea or buttons
            const target = e.target as HTMLElement;
            if (target.tagName === 'TEXTAREA' ||
                target.tagName === 'BUTTON' || target.closest('button') ||
                target.tagName === 'INPUT' || target.closest('input') ||
                target.tagName === 'SELECT' || target.closest('select')) {
                return;
            }

            isDraggingRef.current = true;
            dragStartRef.current = {
                x: e.clientX - textInputState.x,
                y: e.clientY - textInputState.y
            };
            e.preventDefault();
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (isDraggingRef.current) {
                setTextInputState(prev => prev ? {
                    ...prev,
                    x: e.clientX - dragStartRef.current.x,
                    y: e.clientY - dragStartRef.current.y
                } : null);
            }
        };

        const handleMouseUp = () => {
            isDraggingRef.current = false;
        };

        box.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            box.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [textInputState]);

    // Handle text box resizing
    useEffect(() => {
        if (!textInputState?.visible) return;

        const handleResizeMouseDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.classList.contains('resize-handle')) return;

            isResizingRef.current = true;
            resizeStartRef.current = {
                x: e.clientX,
                y: e.clientY,
                width: textInputState.width,
                height: textInputState.height,
                annotationX: 0,
                annotationY: 0
            };
            e.preventDefault();
            e.stopPropagation();
        };

        const handleResizeMouseMove = (e: MouseEvent) => {
            if (isResizingRef.current) {
                const deltaX = e.clientX - resizeStartRef.current.x;
                const deltaY = e.clientY - resizeStartRef.current.y;
                setTextInputState(prev => prev ? {
                    ...prev,
                    width: Math.max(100, resizeStartRef.current.width + deltaX),
                    height: Math.max(50, resizeStartRef.current.height + deltaY)
                } : null);
            }
        };

        const handleResizeMouseUp = () => {
            isResizingRef.current = false;
        };

        document.addEventListener('mousedown', handleResizeMouseDown);
        document.addEventListener('mousemove', handleResizeMouseMove);
        document.addEventListener('mouseup', handleResizeMouseUp);

        return () => {
            document.removeEventListener('mousedown', handleResizeMouseDown);
            document.removeEventListener('mousemove', handleResizeMouseMove);
            document.removeEventListener('mouseup', handleResizeMouseUp);
        };
    }, [textInputState]);

    // Handle click outside text box to commit/close
    useEffect(() => {
        if (!textInputState?.visible) return;

        const handleGlobalMouseDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement;

            // If clicking inside the text box or toolbar, ignore
            if (textBoxRef.current && (textBoxRef.current.contains(target) || target.closest('.text-format-toolbar'))) {
                return;
            }

            // If clicking on a tool button in main toolbar, ignore (let tool switching happen)
            // But usually we want to commit first.
            // If we commit, the tool switch still happens naturally?
            // Actually, if we commit here, textInputState becomes null.

            // Check if we have unsaved text? handleTextSubmit checks if text is empty/valid.
            if (textInputRef.current) {
                // Determine if we should commit or cancel?
                // Standard behavior: commit if valid text, delete if empty.
                handleTextSubmit(textInputRef.current.value);
            }
        };

        // Use capture phase to intercept clicks before they trigger other actions? 
        // Or bubble phase?
        // If capture: we close box, then event propagates to e.g. canvas or toolbar.
        // If we close box, the canvas click handler will run.
        // Canvas handler checks if textInputState is visible? No, it's already null if we close it here.
        // CAUTION: If we close it, and canvas handler runs, it might create a NEW text box at the click location.
        // This is desired behavior: "Click elsewhere to finish editing and start new one".
        document.addEventListener('mousedown', handleGlobalMouseDown, true); // Capture phase

        return () => {
            document.removeEventListener('mousedown', handleGlobalMouseDown, true);
        };
    }, [textInputState, handleTextSubmit]);

    // Restore focus and handle selection conversion when formatting options change
    useEffect(() => {
        if (textInputState?.visible && textInputRef.current) {
            textInputRef.current.focus();

            // Auto-resize
            const target = textInputRef.current;
            target.style.height = 'auto'; // Reset to measure
            const contentHeight = target.scrollHeight;
            target.style.height = '100%';

            if (contentHeight > textInputState.height) {
                setTextInputState(prev => prev ? { ...prev, height: contentHeight + 10 } : null);
            }

            // Apply Subscript/Superscript to selection if active
            // This allows user to select text and click toolbar button
            const start = target.selectionStart;
            const end = target.selectionEnd;

            if (start !== end && (textSubscript || textSuperscript)) {
                const val = target.value;
                const selected = val.slice(start, end);
                let newSelected = '';

                const SUBS: Record<string, string> = {
                    '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
                    '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', 'x': 'ₓ',
                    'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ', 'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'o': 'ₒ', 'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ', 'v': 'ᵥ'
                };
                const SUPS: Record<string, string> = {
                    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
                    '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ',
                    'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ', 'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'j': 'ʲ', 'k': 'ᵏ', 'l': 'ˡ', 'm': 'ᵐ', 'o': 'ᵒ', 'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ', 'v': 'ᵛ', 'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ'
                };

                // Try converting chars
                for (const char of selected) {
                    if (textSubscript && SUBS[char]) newSelected += SUBS[char];
                    else if (textSuperscript && SUPS[char]) newSelected += SUPS[char];
                    else newSelected += char;
                }

                if (newSelected !== selected) {
                    const newVal = val.slice(0, start) + newSelected + val.slice(end);
                    target.value = newVal;
                    // Restore selection around converted text
                    // target.setSelectionRange is lost after React render? No, this is imperative.
                    // But changing .value changes cursor to end usually.
                    // We need to set it back immediately.
                    // However, React might overwrite it on re-render if we don't handle state properly?
                    // target.value is uncontrolled here (defaultValue used).
                    // So this should work.
                    target.setSelectionRange(start, start + newSelected.length);
                }
            }
        }
    }, [textBold, textItalic, textUnderline, textSubscript, textSuperscript, textColor, textFontSize, textFontFamily, textInputState?.visible]);


    // Handle text selection for aware highlighter
    useEffect(() => {
        if (!isTextAware) return;

        const handleSelection = () => {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

            const range = selection.getRangeAt(0);
            const rects = range.getClientRects();

            if (rects.length === 0) return;

            // Use textLayer for accurate page bounds
            const textLayer = textLayerRef?.current;
            const container = containerRef.current;

            // Fallback to container if textLayer missing (though it shouldn't be)
            const referenceElement = textLayer || container;
            if (!referenceElement) return;

            const referenceRect = referenceElement.getBoundingClientRect();

            // If we are falling back to container (which is expanded), we need to adjust
            // But ideally we rely on textLayer which matches the PDF page exactly.

            // Filter rects that intersect the page (allow margins)
            // Actually, don't filter strictly. Text selection might be slightly outside due to line-height/font.
            // Just map everything.

            const normalizedRects = Array.from(rects).map(r => {
                // Determine intersection with page to check validity? 
                // Let's just trust valid browser selection rects typically belong to the text.
                // We normalize relative to the PAGE (textLayer).

                // Note: If using container (expanded), we would need to account for offsets.
                // Using textLayer is safer as it represents 0,0->1,1 of the conceptual page.

                let normX, normY, normW, normH;

                if (referenceElement === textLayer) {
                    normX = (r.left - referenceRect.left) / referenceRect.width;
                    normY = (r.top - referenceRect.top) / referenceRect.height;
                    normW = r.width / referenceRect.width;
                    normH = r.height / referenceRect.height;
                } else {
                    // Fallback to container (Expanded)
                    // Container has padding/offset.
                    // We want coordinates relative to the INNER page.
                    // PageWidth = ContainerWidth / ExpansionRatio
                    // PageLeft = ContainerLeft + (PageWidth * OffsetRatio)
                    // This is complicated. Let's just assume textLayer is always present as it's passed ref.

                    // If really falling back:
                    const expansion = CANVAS_EXPANSION_RATIO;
                    const offset = CANVAS_OFFSET_RATIO;
                    const pageWidth = referenceRect.width / expansion;
                    const pageHeight = referenceRect.height / expansion;
                    const pageLeft = referenceRect.left + (pageWidth * offset);
                    const pageTop = referenceRect.top + (pageHeight * offset);

                    normX = (r.left - pageLeft) / pageWidth;
                    normY = (r.top - pageTop) / pageHeight;
                    normW = r.width / pageWidth;
                    normH = r.height / pageHeight;
                }

                return {
                    x: normX,
                    y: normY,
                    width: normW,
                    height: normH
                };
            });

            const annotation: HighlightAnnotation = {
                id: crypto.randomUUID(),
                type: 'highlight',
                pageNum,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                zIndex: 1,
                locked: false,
                meta: {
                    tool: 'highlighter',
                    isTemporary: false
                },
                geometry: {
                    mode: 'text-aware',
                    rects: normalizedRects
                },
                style: {
                    color: highlighterColor,
                    opacity: highlighterOpacity,
                    blendMode: 'multiply'
                }
            };

            onSave(annotation);
            selection.removeAllRanges();
        };

        const onMouseUp = () => {
            // Small timeout to let selection finalize
            setTimeout(handleSelection, 10);
        };

        document.addEventListener('mouseup', onMouseUp);
        return () => document.removeEventListener('mouseup', onMouseUp);

    }, [isTextAware, pageNum, onSave, highlighterColor, highlighterOpacity]);

    return (
        <div ref={containerRef} className="absolute inset-0 pointer-events-none">
            {/* Committed ink is rasterised off the main thread when supported. */}
            <canvas
                ref={inkCanvasRef}
                className="absolute inset-0 pointer-events-none annotation-layer-ink"
                aria-hidden="true"
                style={{ zIndex: annotationCanvasZ }}
            />

            {/* Annotation Layer - Layer 2 (strokes/highlights/text only) */}
            <canvas
                ref={canvasRef}
                className="absolute inset-0 annotation-layer-strokes"
                data-page-num={pageNum}
                style={{
                    touchAction: 'none',
                    pointerEvents: shouldEnableAnnotationPointerEvents ? 'auto' : 'none',
                    userSelect: 'none', // Prevent text selection on canvas
                    zIndex: annotationCanvasZ,
                }}
            />

            {/* Image/Shape Layer - Layer 3 */}
            <canvas
                ref={imageCanvasRef}
                className="absolute inset-0 annotation-layer-images"
                data-page-num={pageNum}
                style={{
                    touchAction: 'none',
                    pointerEvents: (annotationMode === 'image' || annotationMode === 'math' || awaitingImagePlacement || shouldAllowAnnotationSelection || isHoveringAnnotation) ? 'auto' : 'none',
                    userSelect: 'none',
                    cursor: awaitingImagePlacement ? 'crosshair' : 'default', // Plus sign cursor when awaiting placement
                    zIndex: imageCanvasZ,
                }}
            />


            {/* Preview Layer - Layer 2.5 */}
            <canvas
                ref={previewCanvasRef}
                className="absolute inset-0 pointer-events-none"
                style={{
                    touchAction: 'none',
                }}
            />

            {/* Predicted points are disposable and never enter annotation state. */}
            <canvas
                ref={predictionCanvasRef}
                className="absolute inset-0 pointer-events-none"
                aria-hidden="true"
            />

            {/* Text Input Overlay */}
            {textInputState?.visible && (
                <div
                    ref={textBoxRef}
                    className="absolute pointer-events-auto"
                    style={{
                        left: `${textInputState.x}px`,
                        top: `${textInputState.y}px`,
                        width: `${textInputState.width}px`,
                        minHeight: `${textInputState.height}px`,
                    }}
                >
                    <FloatingFormatToolbar />
                    <div
                        className="relative border-2 rounded shadow-lg"
                        style={{
                            borderColor: isDarkMode ? '#3B82F6' : '#3B82F6',
                            backgroundColor: textBackgroundColor === 'transparent' ? 'transparent' : textBackgroundColor,
                            backgroundImage: textBackgroundColor === 'transparent'
                                ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)'
                                : 'none',
                            backgroundSize: textBackgroundColor === 'transparent' ? '8px 8px' : 'auto',
                            backgroundPosition: textBackgroundColor === 'transparent' ? '0 0, 0 4px, 4px -4px, -4px 0px' : 'auto'
                        }}
                    >
                        {/* Action Buttons */}
                        <div className="absolute top-1 right-1 flex gap-1 z-10">
                            <button
                                onClick={() => {
                                    if (textInputRef.current) {
                                        handleTextSubmit(textInputRef.current.value);
                                    }
                                }}
                                className={cn(
                                    "p-1 rounded transition-all",
                                    isDarkMode
                                        ? "bg-green-600 hover:bg-green-700 text-white"
                                        : "bg-green-500 hover:bg-green-600 text-white"
                                )}
                                aria-label="Commit text"
                                title="Commit (Ctrl+Enter)"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            </button>
                            <button
                                onClick={handleTextCancel}
                                className={cn(
                                    "p-1 rounded transition-all",
                                    isDarkMode
                                        ? "bg-red-600 hover:bg-red-700 text-white"
                                        : "bg-red-500 hover:bg-red-600 text-white"
                                )}
                                aria-label="Cancel"
                                title="Cancel (Esc)"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        </div>

                        <textarea
                            ref={textInputRef}
                            className={cn(
                                "w-full h-full p-2 rounded resize-none outline-none",
                                isDarkMode ? "text-white" : "text-black"
                            )}
                            style={{
                                fontSize: `${textFontSize}px`,
                                fontFamily: textFontFamily,
                                fontWeight: textBold ? 'bold' : 'normal',
                                fontStyle: textItalic ? 'italic' : 'normal',
                                textDecoration: textUnderline ? 'underline' : 'none',
                                color: textColor,
                                backgroundColor: 'transparent',
                                border: 'none',
                                resize: 'none',
                            }}
                            placeholder="Type your text..."
                            defaultValue={textInputState.initialText || ''}
                            onChange={(e) => {
                                // Auto-resize height based on content
                                const target = e.target;
                                target.style.height = 'auto';
                                const contentHeight = target.scrollHeight;
                                target.style.height = '100%'; // Restore 100% to fill container

                                // Update container to fit content (plus limits)
                                if (contentHeight > textInputState.height) {
                                    setTextInputState(prev => prev ? { ...prev, height: contentHeight + 10 } : null);
                                }

                                // Handle simple Subscript/Superscript replacement for Digits
                                if (textSubscript || textSuperscript) {
                                    const val = e.target.value;
                                    const lastChar = val.slice(-1);

                                    const SUBS: Record<string, string> = {
                                        '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
                                        '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', 'x': 'ₓ',
                                        'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ', 'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'o': 'ₒ', 'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ', 'v': 'ᵥ'
                                    };
                                    const SUPS: Record<string, string> = {
                                        '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
                                        '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ',
                                        'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ', 'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'j': 'ʲ', 'k': 'ᵏ', 'l': 'ˡ', 'm': 'ᵐ', 'o': 'ᵒ', 'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ', 'v': 'ᵛ', 'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ'
                                    };

                                    if (textSubscript && SUBS[lastChar]) {
                                        const newVal = val.slice(0, -1) + SUBS[lastChar];
                                        e.target.value = newVal;
                                    } else if (textSuperscript && SUPS[lastChar]) {
                                        const newVal = val.slice(0, -1) + SUPS[lastChar];
                                        e.target.value = newVal;
                                    }
                                }
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                    e.preventDefault();
                                    handleTextSubmit(e.currentTarget.value);
                                } else if (e.key === 'Escape') {
                                    handleTextCancel();
                                }
                            }}
                            autoFocus
                        />

                        {/* Resize Handle */}
                        <div
                            className="resize-handle absolute bottom-0 right-0 w-6 h-6 cursor-se-resize z-10"
                            style={{
                                background: 'linear-gradient(135deg, transparent 50%, #3B82F6 50%)',
                                borderBottomRightRadius: '4px' // Match container radius
                            }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
