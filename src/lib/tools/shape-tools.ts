import { BaseTool } from './base-tool';
import type { PointerState, ShapeAnnotation, BoundingBox, Point } from '../annotations/models';
import { normalizePoint, denormalizePoint } from '../rendering/stroke-smoother';

export type ShapeType = 'rectangle' | 'ellipse' | 'arrow' | 'line';

export class RectangleTool extends BaseTool {
    private pageWidth = 0;
    private pageHeight = 0;
    private color = '#000000';
    private strokeWidth = 2;
    private startPoint: Point | null = null;
    private currentEndPoint: Point | null = null;
    private rafId?: number;

    constructor(pageWidth: number, pageHeight: number, color = '#000000', strokeWidth = 2) {
        super();
        this.pageWidth = pageWidth;
        this.pageHeight = pageHeight;
        this.color = color;
        this.strokeWidth = strokeWidth;
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
        const normalized = normalizePoint(state.x, state.y, this.pageWidth, this.pageHeight);
        this.startPoint = { x: normalized.x, y: normalized.y };
        this.currentEndPoint = { x: normalized.x, y: normalized.y };
    }

    onPointerMove(state: PointerState, ctx: CanvasRenderingContext2D): void {
        if (!this.isDrawing || !this.startPoint) return;

        const normalized = normalizePoint(state.x, state.y, this.pageWidth, this.pageHeight);
        this.currentEndPoint = { x: normalized.x, y: normalized.y };

        // Use requestAnimationFrame for smooth preview rendering
        if (!this.rafId) {
            this.rafId = requestAnimationFrame(() => {
                this.render(ctx);
                this.rafId = undefined;
            });
        }
    }

    onPointerUp(_state: PointerState, _ctx: CanvasRenderingContext2D): ShapeAnnotation | null {
        if (!this.isDrawing || !this.startPoint || !this.currentEndPoint) {
            this.isDrawing = false;
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = undefined;
            }
            return null;
        }

        // Cancel any pending RAF
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = undefined;
        }

        this.isDrawing = false;

        // Calculate bounding box
        const minX = Math.min(this.startPoint.x, this.currentEndPoint.x);
        const minY = Math.min(this.startPoint.y, this.currentEndPoint.y);
        const maxX = Math.max(this.startPoint.x, this.currentEndPoint.x);
        const maxY = Math.max(this.startPoint.y, this.currentEndPoint.y);

        // Don't create if too small
        if (maxX - minX < 0.01 || maxY - minY < 0.01) {
            this.startPoint = null;
            this.currentEndPoint = null;
            return null;
        }

        const boundingBox: BoundingBox = {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
        };

        const annotation: ShapeAnnotation = {
            id: crypto.randomUUID(),
            type: 'shape',
            shapeType: 'rectangle',
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
                tool: 'rectangle',
            },
            geometry: {
                boundingBox,
            },
        };

        this.startPoint = null;
        this.currentEndPoint = null;

        return annotation;
    }

    render(ctx: CanvasRenderingContext2D): void {
        if (!this.startPoint || !this.currentEndPoint) return;

        const start = denormalizePoint(this.startPoint.x, this.startPoint.y, this.pageWidth, this.pageHeight);
        const end = denormalizePoint(this.currentEndPoint.x, this.currentEndPoint.y, this.pageWidth, this.pageHeight);

        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const width = Math.abs(end.x - start.x);
        const height = Math.abs(end.y - start.y);

        // Clip to page bounds to prevent layout shifts



        ctx.save();

        // Set clip region to page bounds
        ctx.beginPath();
        ctx.rect(0, 0, this.pageWidth, this.pageHeight);
        ctx.clip();

        ctx.strokeStyle = this.color;
        ctx.lineWidth = this.strokeWidth;
        ctx.globalAlpha = 1;
        ctx.setLineDash([5, 5]); // Dashed for preview

        ctx.strokeRect(x, y, width, height);
        ctx.restore();
    }

    getCursor(): string {
        return 'crosshair';
    }
}

export class ArrowTool extends BaseTool {
    private pageWidth = 0;
    private pageHeight = 0;
    private color = '#000000';
    private strokeWidth = 2;
    private startPoint: Point | null = null;
    private currentEndPoint: Point | null = null;
    private rafId?: number;

    constructor(pageWidth: number, pageHeight: number, color = '#000000', strokeWidth = 2) {
        super();
        this.pageWidth = pageWidth;
        this.pageHeight = pageHeight;
        this.color = color;
        this.strokeWidth = strokeWidth;
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
        const normalized = normalizePoint(state.x, state.y, this.pageWidth, this.pageHeight);
        this.startPoint = { x: normalized.x, y: normalized.y };
        this.currentEndPoint = { x: normalized.x, y: normalized.y };
    }

    onPointerMove(state: PointerState, ctx: CanvasRenderingContext2D): void {
        if (!this.isDrawing || !this.startPoint) return;

        const normalized = normalizePoint(state.x, state.y, this.pageWidth, this.pageHeight);
        this.currentEndPoint = { x: normalized.x, y: normalized.y };

        // Use requestAnimationFrame for smooth preview rendering
        if (!this.rafId) {
            this.rafId = requestAnimationFrame(() => {
                this.render(ctx);
                this.rafId = undefined;
            });
        }
    }

    onPointerUp(_state: PointerState, _ctx: CanvasRenderingContext2D): ShapeAnnotation | null {
        if (!this.isDrawing || !this.startPoint || !this.currentEndPoint) {
            this.isDrawing = false;
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = undefined;
            }
            return null;
        }

        // Cancel any pending RAF
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = undefined;
        }

        this.isDrawing = false;

        // Don't create if too short
        const dx = this.currentEndPoint.x - this.startPoint.x;
        const dy = this.currentEndPoint.y - this.startPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 0.01) {
            this.startPoint = null;
            this.currentEndPoint = null;
            return null;
        }

        // Calculate bounding box
        const minX = Math.min(this.startPoint.x, this.currentEndPoint.x);
        const minY = Math.min(this.startPoint.y, this.currentEndPoint.y);
        const maxX = Math.max(this.startPoint.x, this.currentEndPoint.x);
        const maxY = Math.max(this.startPoint.y, this.currentEndPoint.y);

        const boundingBox: BoundingBox = {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
        };

        const annotation: ShapeAnnotation = {
            id: crypto.randomUUID(),
            type: 'shape',
            shapeType: 'arrow',
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
                tool: 'arrow',
            },
            geometry: {
                boundingBox,
                // Store as local coordinates relative to bounding box [0..1]
                startPoint: {
                    x: boundingBox.width > 1e-6 ? (this.startPoint.x - boundingBox.x) / boundingBox.width : 0,
                    y: boundingBox.height > 1e-6 ? (this.startPoint.y - boundingBox.y) / boundingBox.height : 0
                },
                endPoint: {
                    x: boundingBox.width > 1e-6 ? (this.currentEndPoint.x - boundingBox.x) / boundingBox.width : 1,
                    y: boundingBox.height > 1e-6 ? (this.currentEndPoint.y - boundingBox.y) / boundingBox.height : 1
                },
            },
        };

        this.startPoint = null;
        this.currentEndPoint = null;

        return annotation;
    }

    render(ctx: CanvasRenderingContext2D): void {
        if (!this.startPoint || !this.currentEndPoint) return;

        const start = denormalizePoint(this.startPoint.x, this.startPoint.y, this.pageWidth, this.pageHeight);
        const end = denormalizePoint(this.currentEndPoint.x, this.currentEndPoint.y, this.pageWidth, this.pageHeight);

        // Clip to page bounds
        const clampedStart = {
            x: Math.max(0, Math.min(start.x, this.pageWidth)),
            y: Math.max(0, Math.min(start.y, this.pageHeight))
        };
        const clampedEnd = {
            x: Math.max(0, Math.min(end.x, this.pageWidth)),
            y: Math.max(0, Math.min(end.y, this.pageHeight))
        };

        ctx.save();

        // Set clip region to page bounds
        ctx.beginPath();
        ctx.rect(0, 0, this.pageWidth, this.pageHeight);
        ctx.clip();

        ctx.strokeStyle = this.color;
        ctx.lineWidth = this.strokeWidth;
        ctx.globalAlpha = 1;
        ctx.setLineDash([5, 5]); // Dashed for preview

        // Draw line
        ctx.beginPath();
        ctx.moveTo(clampedStart.x, clampedStart.y);
        ctx.lineTo(clampedEnd.x, clampedEnd.y);
        ctx.stroke();

        // Draw arrowhead
        const angle = Math.atan2(clampedEnd.y - clampedStart.y, clampedEnd.x - clampedStart.x);
        const arrowLength = 15;
        const arrowAngle = Math.PI / 6; // 30 degrees

        ctx.beginPath();
        ctx.moveTo(clampedEnd.x, clampedEnd.y);
        ctx.lineTo(
            clampedEnd.x - arrowLength * Math.cos(angle - arrowAngle),
            clampedEnd.y - arrowLength * Math.sin(angle - arrowAngle)
        );
        ctx.moveTo(clampedEnd.x, clampedEnd.y);
        ctx.lineTo(
            clampedEnd.x - arrowLength * Math.cos(angle + arrowAngle),
            clampedEnd.y - arrowLength * Math.sin(angle + arrowAngle)
        );
        ctx.stroke();

        ctx.restore();
    }

    getCursor(): string {
        return 'crosshair';
    }
}


