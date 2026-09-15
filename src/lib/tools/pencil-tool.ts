import { BaseTool } from './base-tool';
import type { PointerState, StrokeAnnotation, StrokePoint } from '../annotations/models';
import { normalizePoint } from '../rendering/stroke-smoother';
import { processStrokeAsync } from '../workers/stroke-worker-manager';
import { StrokePredictor } from '@/core/ink/kalman';

export class PencilTool extends BaseTool {
    private currentStroke: StrokePoint[] = [];
    private pageWidth = 0;
    private pageHeight = 0;
    private color = '#000000';
    private strokeWidth = 2;
    private onStrokeComplete?: (annotation: StrokeAnnotation) => void;
    private readonly predictor = new StrokePredictor();
    private predictedPoint: { x: number; y: number } | null = null;

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

    onPointerDown(state: PointerState): void {
        this.isDrawing = true;
        this.currentStroke = [];
        this.predictor.reset();
        this.predictor.update({ x: state.x, y: state.y }, state.timestamp);
        this.predictedPoint = null;

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

        this.predictor.update({ x: state.x, y: state.y }, state.timestamp);
        this.predictedPoint = this.predictor.predict(16);
        this.renderLatestSegment(ctx);
    }

    onPointerUp(state: PointerState): StrokeAnnotation | null {
        if (!this.isDrawing) return null;

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
        const rawPoints = [...this.currentStroke];
        const color = this.color;
        const strokeWidth = this.strokeWidth;
        this.currentStroke = [];
        this.predictedPoint = null;

        processStrokeAsync({
            points: rawPoints,
            width: this.pageWidth,
            height: this.pageHeight,
            epsilonPx: 0.75,
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
                    color,
                    opacity: 1,
                    width: strokeWidth,
                },
                meta: {
                    tool: 'pencil',
                    strokeSmoothness: 0.5,
                    compressionLevel: result.compressionRatio,
                },
                geometry: {
                    points: result.points,
                    beziers: result.beziers,
                    smoothed: true,
                    compressed: true,
                },
            };

            // Call completion callback if provided
            if (this.onStrokeComplete) {
                this.onStrokeComplete(annotation);
            }
        }).catch((error) => {
            console.error('Stroke processing failed:', error);
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

    private renderLatestSegment(ctx: CanvasRenderingContext2D): void {
        if (this.currentStroke.length < 2) return;
        const start = this.currentStroke[this.currentStroke.length - 2];
        const end = this.currentStroke[this.currentStroke.length - 1];
        ctx.save();
        ctx.strokeStyle = this.color;
        ctx.lineWidth = this.strokeWidth * (0.5 + (end.pressure || 1) * 0.5);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(start.x * this.pageWidth, start.y * this.pageHeight);
        ctx.lineTo(end.x * this.pageWidth, end.y * this.pageHeight);
        ctx.stroke();
        ctx.restore();
    }

    renderPrediction(ctx: CanvasRenderingContext2D): void {
        const last = this.currentStroke.at(-1);
        if (!last || !this.predictedPoint) return;
        ctx.save();
        ctx.strokeStyle = this.color;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = this.strokeWidth * (0.5 + (last.pressure || 1) * 0.5);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(last.x * this.pageWidth, last.y * this.pageHeight);
        ctx.lineTo(this.predictedPoint.x, this.predictedPoint.y);
        ctx.stroke();
        ctx.restore();
    }

    getPredictionBounds(): { x: number; y: number; width: number; height: number } | null {
        const last = this.currentStroke.at(-1);
        if (!last || !this.predictedPoint) return null;
        const start = { x: last.x * this.pageWidth, y: last.y * this.pageHeight };
        const padding = this.strokeWidth + 2;
        const minX = Math.min(start.x, this.predictedPoint.x) - padding;
        const minY = Math.min(start.y, this.predictedPoint.y) - padding;
        return {
            x: minX,
            y: minY,
            width: Math.max(1, Math.max(start.x, this.predictedPoint.x) + padding - minX),
            height: Math.max(1, Math.max(start.y, this.predictedPoint.y) + padding - minY),
        };
    }

    getCursor(): string {
        return 'crosshair';
    }
}
