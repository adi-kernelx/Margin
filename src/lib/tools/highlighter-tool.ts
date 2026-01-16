import { BaseTool } from './base-tool';
import type { PointerState, HighlightAnnotation, StrokePoint, TextHighlightRect } from '../annotations/models';
import { normalizePoint } from '../rendering/stroke-smoother';
import { processStrokeAsync } from '../workers/stroke-worker-manager';
import type { HighlighterMode } from '@/lib/store';

export class HighlighterTool extends BaseTool {
    private currentStroke: StrokePoint[] = [];
    private pageWidth = 0;
    private pageHeight = 0;
    private color = '#FFEB3B'; // Default yellow
    private strokeWidth = 12;  // Thicker for highlighter
    private onStrokeComplete?: (annotation: HighlightAnnotation) => void;
    private processingStroke = false;
    private mode: HighlighterMode = 'freeform';
    private opacity: number = 0.25;
    private textLayerRef?: React.RefObject<HTMLDivElement>;

    constructor(
        pageWidth: number,
        pageHeight: number,
        color = '#FFEB3B',
        strokeWidth = 12,
        onStrokeComplete?: (annotation: HighlightAnnotation) => void,
        mode: HighlighterMode = 'freeform',
        opacity: number = 0.25,
        textLayerRef?: React.RefObject<HTMLDivElement>
    ) {
        super();
        this.pageWidth = pageWidth;
        this.pageHeight = pageHeight;
        this.color = color;
        this.strokeWidth = strokeWidth;
        this.onStrokeComplete = onStrokeComplete;
        this.mode = mode;
        this.opacity = opacity;
        this.textLayerRef = textLayerRef;
    }

    setColor(color: string): void {
        this.color = color;
    }

    setStrokeWidth(width: number): void {
        this.strokeWidth = width;
    }

    setMode(mode: HighlighterMode): void {
        this.mode = mode;
    }

    setOpacity(opacity: number): void {
        this.opacity = opacity;
    }

    updatePageDimensions(width: number, height: number): void {
        this.pageWidth = width;
        this.pageHeight = height;
    }

    onPointerDown(state: PointerState, _ctx: CanvasRenderingContext2D): void {
        // For text-aware mode, check if text is selected
        if (this.mode === 'text-aware') {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                // Text is selected, create text-aware highlight
                this.createTextAwareHighlight(selection);
                return;
            }
            // No text selected, ignore
            return;
        }

        // Freeform mode - start drawing
        this.isDrawing = true;
        this.currentStroke = [];

        // Add first point
        const normalized = normalizePoint(state.x, state.y, this.pageWidth, this.pageHeight);
        this.currentStroke.push({
            x: normalized.x,
            y: normalized.y,
            pressure: state.pressure,
            timestamp: state.timestamp,
        });
    }

    private createTextAwareHighlight(selection: Selection): void {
        if (!this.textLayerRef?.current) return;

        const range = selection.getRangeAt(0);
        const textLayer = this.textLayerRef.current;
        const rects: TextHighlightRect[] = [];

        // Get all text spans in the selection that are within the text layer
        const walker = document.createTreeWalker(
            range.commonAncestorContainer,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    if (range.intersectsNode(node)) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_REJECT;
                }
            }
        );

        const textNodes: Text[] = [];
        let node;
        while (node = walker.nextNode()) {
            if (node instanceof Text) {
                textNodes.push(node);
            }
        }

        // For each text node, find its position relative to the text layer
        textNodes.forEach((textNode) => {
            const span = textNode.parentElement;
            if (!span || !textLayer.contains(span)) return;

            const spanRect = span.getBoundingClientRect();
            const layerRect = textLayer.getBoundingClientRect();

            // Convert to coordinates relative to text layer
            const x = (spanRect.left - layerRect.left) / this.pageWidth;
            const y = (spanRect.top - layerRect.top) / this.pageHeight;
            const width = spanRect.width / this.pageWidth;
            const height = spanRect.height / this.pageHeight;

            rects.push({
                x: Math.max(0, Math.min(1, x)),
                y: Math.max(0, Math.min(1, y)),
                width: Math.max(0, Math.min(1, width)),
                height: Math.max(0, Math.min(1, height)),
            });
        });

        if (rects.length === 0) return;

        // Create text-aware highlight annotation
        const annotation: HighlightAnnotation = {
            id: crypto.randomUUID(),
            type: 'highlight',
            pageNum: 1, // Will be set by canvas
            createdAt: Date.now(),
            updatedAt: Date.now(),
            zIndex: 0,
            locked: false,
            style: {
                color: this.color,
                opacity: this.opacity,
                width: this.strokeWidth,
                blendMode: 'multiply',
            },
            meta: {
                tool: 'highlighter',
            },
            geometry: {
                mode: 'text-aware',
                rects: rects,
            },
        };

        // Clear selection
        selection.removeAllRanges();

        // Call completion callback
        if (this.onStrokeComplete) {
            this.onStrokeComplete(annotation);
        }
    }

    onPointerMove(state: PointerState, ctx: CanvasRenderingContext2D): void {
        if (!this.isDrawing) return;

        // Add point to current stroke
        const normalized = normalizePoint(state.x, state.y, this.pageWidth, this.pageHeight);
        this.currentStroke.push({
            x: normalized.x,
            y: normalized.y,
            pressure: state.pressure,
            timestamp: state.timestamp,
        });

        // Render preview
        this.render(ctx);
    }

    onPointerUp(state: PointerState, _ctx: CanvasRenderingContext2D): HighlightAnnotation | null {
        if (!this.isDrawing || this.processingStroke) return null;

        this.isDrawing = false;

        // Add final point
        const normalized = normalizePoint(state.x, state.y, this.pageWidth, this.pageHeight);
        this.currentStroke.push({
            x: normalized.x,
            y: normalized.y,
            pressure: state.pressure,
            timestamp: state.timestamp,
        });

        // Don't create annotation if stroke is too short
        if (this.currentStroke.length < 2) {
            this.currentStroke = [];
            return null;
        }

        // Process stroke asynchronously in worker
        this.processingStroke = true;
        const rawPoints = [...this.currentStroke];

        processStrokeAsync({
            points: rawPoints,
            tension: 0.5,
            epsilon: 0.001,
        }).then((result) => {
            // Create annotation with processed points
            const annotation: HighlightAnnotation = {
                id: crypto.randomUUID(),
                type: 'highlight',
                pageNum: 1, // Will be set by the canvas component
                createdAt: Date.now(),
                updatedAt: Date.now(),
                zIndex: 0,
                locked: false,
                style: {
                    color: this.color,
                    opacity: this.opacity,
                    width: this.strokeWidth,
                    blendMode: 'multiply',
                },
                meta: {
                    tool: 'highlighter',
                    strokeSmoothness: 0.5,
                },
                geometry: {
                    mode: 'freehand',
                    path: result.points,
                },
            };

            // Clear current stroke
            this.currentStroke = [];
            this.processingStroke = false;

            // Call completion callback if provided
            if (this.onStrokeComplete) {
                this.onStrokeComplete(annotation);
            }
        }).catch((error) => {
            console.error('Stroke processing failed:', error);
            this.processingStroke = false;
            this.currentStroke = [];
        });

        // Return null immediately - annotation will be created async
        return null;
    }

    render(ctx: CanvasRenderingContext2D): void {
        if (this.currentStroke.length < 2) return;

        ctx.save();
        ctx.strokeStyle = this.color;
        ctx.lineWidth = this.strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.5;
        ctx.globalCompositeOperation = 'multiply';

        ctx.beginPath();

        // Denormalize first point
        const firstPoint = this.currentStroke[0];
        ctx.moveTo(firstPoint.x * this.pageWidth, firstPoint.y * this.pageHeight);

        // Draw all points
        for (let i = 1; i < this.currentStroke.length; i++) {
            const point = this.currentStroke[i];
            const x = point.x * this.pageWidth;
            const y = point.y * this.pageHeight;

            // Highlighters usually don't have pressure sensitivity affecting width as much
            ctx.lineTo(x, y);
        }

        ctx.stroke();
        ctx.restore();
    }

    getCursor(): string {
        return 'text'; // Or a custom highlighter cursor
    }
}
