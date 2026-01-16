import { BaseTool } from './base-tool';
import type { PointerState, StrokeAnnotation, StrokePoint } from '../annotations/models';
import { normalizePoint } from '../rendering/stroke-smoother';
import { processStrokeAsync } from '../workers/stroke-worker-manager';

export class PencilTool extends BaseTool {
    private currentStroke: StrokePoint[] = [];
    private pageWidth = 0;
    private pageHeight = 0;
    private color = '#000000';
    private strokeWidth = 2;
    private onStrokeComplete?: (annotation: StrokeAnnotation) => void;
    private processingStroke = false;

    constructor(
        pageWidth: number,
        pageHeight: number,
        color = '#000000',
        strokeWidth = 2,
        onStrokeComplete?: (annotation: StrokeAnnotation) => void
    ) {
        super();
        this.pageWidth = pageWidth;
        this.pageHeight = pageHeight;
        this.color = color;
        this.strokeWidth = strokeWidth;
        this.onStrokeComplete = onStrokeComplete;
    }

    setColor(color: string): void {
        this.color = color;
    }

    setStrokeWidth(width: number): void {
        this.strokeWidth = width;
    }

    updatePageDimensions(width: number, height: number): void {
        this.pageWidth = width;
        this.pageHeight = height;
    }

    onPointerDown(state: PointerState, _ctx: CanvasRenderingContext2D): void {
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

    onPointerUp(state: PointerState, _ctx: CanvasRenderingContext2D): StrokeAnnotation | null {
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
            const annotation: StrokeAnnotation = {
                id: crypto.randomUUID(),
                type: 'stroke',
                pageNum: 1, // Will be set by the canvas component
                createdAt: Date.now(),
                updatedAt: Date.now(),
                zIndex: 0,
                locked: false,
                style: {
                    color: this.color,
                    opacity: 1,
                    width: this.strokeWidth,
                },
                meta: {
                    tool: 'pencil',
                    strokeSmoothness: 0.5,
                    compressionLevel: result.compressedCount / result.originalCount,
                },
                geometry: {
                    points: result.points,
                    smoothed: true,
                    compressed: true,
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
        // The raw stroke is still visible until processed version replaces it
        return null;
    }

    render(ctx: CanvasRenderingContext2D): void {
        if (this.currentStroke.length < 2) return;

        ctx.save();
        ctx.strokeStyle = this.color;
        ctx.lineWidth = this.strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();

        // Denormalize first point
        const firstPoint = this.currentStroke[0];
        ctx.moveTo(firstPoint.x * this.pageWidth, firstPoint.y * this.pageHeight);

        // Draw all points
        for (let i = 1; i < this.currentStroke.length; i++) {
            const point = this.currentStroke[i];
            const x = point.x * this.pageWidth;
            const y = point.y * this.pageHeight;

            // Apply pressure if available
            if (point.pressure !== undefined && point.pressure > 0) {
                ctx.lineWidth = this.strokeWidth * (0.5 + point.pressure * 0.5);
            }

            ctx.lineTo(x, y);
        }

        ctx.stroke();
        ctx.restore();
    }

    getCursor(): string {
        return 'crosshair';
    }
}
