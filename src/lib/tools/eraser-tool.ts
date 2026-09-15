import { erasePolyline, polylineIntersectsCapsule } from '@/core/ink/geometry';
import { processStroke } from '@/core/ink/stroke-processing';
import type { Point2D } from '@/core/ink/geometry';
import { BaseTool } from './base-tool';
import type { Annotation, PointerState, StrokeAnnotation, StrokePoint } from '../annotations/models';
import type { AnnotationQuadtree } from '../annotations/spatial-index';
import type { EraserMode } from '../store';

interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

interface EraserSession {
    mode: EraserMode;
    radius: number;
    path: Point2D[];
    pathBounds: Bounds;
    candidates: Set<string>;
}

export class EraserTool extends BaseTool {
    private eraserRadius = 20;
    private currentPointer: Point2D | null = null;
    private activeSession: EraserSession | null = null;
    private pageWidth: number;
    private pageHeight: number;
    private quadtree: AnnotationQuadtree;
    private readonly onErase: (deletes: string[], creates: Annotation[]) => void;
    private mode: EraserMode;
    private annotations: Annotation[];

    constructor(
        pageWidth: number,
        pageHeight: number,
        quadtree: AnnotationQuadtree,
        onErase: (deletes: string[], creates: Annotation[]) => void,
        mode: EraserMode = 'stroke',
        annotations: Annotation[] = [],
    ) {
        super();
        this.pageWidth = pageWidth;
        this.pageHeight = pageHeight;
        this.quadtree = quadtree;
        this.onErase = onErase;
        this.mode = mode;
        this.annotations = annotations;
    }

    updatePageDimensions(width: number, height: number): void {
        this.pageWidth = width;
        this.pageHeight = height;
    }

    updateQuadtree(quadtree: AnnotationQuadtree): void {
        this.quadtree = quadtree;
    }

    updateAnnotations(annotations: Annotation[]): void {
        this.annotations = annotations;
    }

    setMode(mode: EraserMode): void {
        this.mode = mode;
    }

    setRadius(radius: number): void {
        this.eraserRadius = radius;
    }

    onPointerDown(state: PointerState): void {
        this.isDrawing = true;
        this.currentPointer = { x: state.x, y: state.y };
        this.activeSession = {
            mode: this.mode,
            radius: this.eraserRadius,
            path: [{ ...this.currentPointer }],
            pathBounds: this.boundsForPath([this.currentPointer]),
            candidates: new Set(),
        };
        this.updateCandidates(this.activeSession);
    }

    onPointerMove(state: PointerState, ctx: CanvasRenderingContext2D): void {
        this.currentPointer = { x: state.x, y: state.y };
        const session = this.activeSession;
        if (this.isDrawing && session) {
            const previous = session.path.at(-1)!;
            if (Math.hypot(state.x - previous.x, state.y - previous.y) >= 1.5) {
                session.path.push({ x: state.x, y: state.y });
                session.pathBounds = this.boundsForPath(session.path);
                this.updateCandidates(session);
            }
        }
        this.render(ctx);
    }

    onPointerUp(state: PointerState): null {
        this.isDrawing = false;
        const session = this.activeSession;
        if (session) {
            session.path.push({ x: state.x, y: state.y });
            session.pathBounds = this.boundsForPath(session.path);
            this.updateCandidates(session);
            this.commit(session);
        }
        this.activeSession = null;
        this.currentPointer = null;
        return null;
    }

    private boundsForPath(path: Point2D[]): Bounds {
        const xs = path.map(point => point.x);
        const ys = path.map(point => point.y);
        return {
            minX: Math.min(...xs) - this.eraserRadius,
            minY: Math.min(...ys) - this.eraserRadius,
            maxX: Math.max(...xs) + this.eraserRadius,
            maxY: Math.max(...ys) + this.eraserRadius,
        };
    }

    private updateCandidates(session: EraserSession): void {
        const bounds = session.pathBounds;
        const candidates = this.quadtree.query({
            x: bounds.minX / this.pageWidth,
            y: bounds.minY / this.pageHeight,
            width: (bounds.maxX - bounds.minX) / this.pageWidth,
            height: (bounds.maxY - bounds.minY) / this.pageHeight,
        });
        for (const annotation of candidates) {
            if (!session.candidates.has(annotation.id) && this.intersects(annotation, session)) {
                session.candidates.add(annotation.id);
            }
        }
    }

    private toScreenPoints(points: StrokePoint[]): StrokePoint[] {
        return points.map(point => ({
            ...point,
            x: point.x * this.pageWidth,
            y: point.y * this.pageHeight,
        }));
    }

    private boxPath(x: number, y: number, width: number, height: number): Point2D[] {
        return [
            { x, y },
            { x: x + width, y },
            { x: x + width, y: y + height },
            { x, y: y + height },
            { x, y },
        ];
    }

    private pathIntersectsBox(path: Point2D[], radius: number, box: { x: number; y: number; width: number; height: number }): boolean {
        const inside = path.some(point => point.x >= box.x && point.x <= box.x + box.width
            && point.y >= box.y && point.y <= box.y + box.height);
        return inside || polylineIntersectsCapsule(this.boxPath(box.x, box.y, box.width, box.height), path, radius);
    }

    private intersects(annotation: Annotation, session: EraserSession): boolean {
        if (annotation.type === 'stroke') {
            return polylineIntersectsCapsule(this.toScreenPoints(annotation.geometry.points), session.path, session.radius);
        }
        if (annotation.type === 'highlight') {
            if (annotation.geometry.mode === 'freehand') {
                return polylineIntersectsCapsule(this.toScreenPoints(annotation.geometry.path || []), session.path, session.radius);
            }
            return (annotation.geometry.rects || []).some(rect => this.pathIntersectsBox(session.path, session.radius, {
                x: rect.x * this.pageWidth,
                y: rect.y * this.pageHeight,
                width: rect.width * this.pageWidth,
                height: rect.height * this.pageHeight,
            }));
        }
        const box = annotation.geometry.boundingBox;
        return this.pathIntersectsBox(session.path, session.radius, {
            x: box.x * this.pageWidth,
            y: box.y * this.pageHeight,
            width: box.width * this.pageWidth,
            height: box.height * this.pageHeight,
        });
    }

    private commit(session: EraserSession): void {
        const deletedIds: string[] = [];
        const created: Annotation[] = [];
        for (const id of session.candidates) {
            const annotation = this.annotations.find(candidate => candidate.id === id);
            if (!annotation) continue;
            deletedIds.push(id);
            if (session.mode === 'point' && annotation.type === 'stroke') {
                created.push(...this.splitStroke(annotation, session));
            }
        }
        if (deletedIds.length > 0 || created.length > 0) this.onErase(deletedIds, created);
    }

    private splitStroke(annotation: StrokeAnnotation, session: EraserSession): StrokeAnnotation[] {
        return erasePolyline(this.toScreenPoints(annotation.geometry.points), session.path, session.radius)
            .filter(segment => this.length(segment) >= session.radius * 0.5)
            .map(segment => {
                const normalized = segment.map(point => ({
                    ...point,
                    x: point.x / this.pageWidth,
                    y: point.y / this.pageHeight,
                }));
                const processed = processStroke(normalized, this.pageWidth, this.pageHeight, 0.75);
                return {
                    ...annotation,
                    id: crypto.randomUUID(),
                    updatedAt: Date.now(),
                    geometry: {
                        points: processed.points,
                        beziers: processed.beziers,
                        smoothed: true,
                        compressed: true,
                    },
                    meta: { ...annotation.meta, compressionLevel: processed.compressionRatio },
                };
            });
    }

    private length(points: Point2D[]): number {
        let total = 0;
        for (let index = 1; index < points.length; index += 1) {
            total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
        }
        return total;
    }

    render(ctx: CanvasRenderingContext2D): void {
        if (!this.currentPointer) return;
        ctx.save();
        ctx.strokeStyle = this.mode === 'stroke' ? '#dc2626' : '#2563eb';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.currentPointer.x, this.currentPointer.y, this.eraserRadius, 0, Math.PI * 2);
        ctx.stroke();
        const session = this.activeSession;
        if (this.isDrawing && session && session.path.length > 1) {
            ctx.globalAlpha = 0.15;
            ctx.lineWidth = session.radius * 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(session.path[0].x, session.path[0].y);
            for (const point of session.path.slice(1)) ctx.lineTo(point.x, point.y);
            ctx.stroke();
        }
        ctx.restore();
    }

    getCursor(): string {
        return 'none';
    }
}
