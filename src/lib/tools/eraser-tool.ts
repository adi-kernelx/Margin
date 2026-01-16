import { BaseTool } from './base-tool';
import type { PointerState, Annotation, StrokeAnnotation } from '../annotations/models';
import type { AnnotationQuadtree } from '../annotations/spatial-index';
import { normalizePoint, denormalizePoint } from '../rendering/stroke-smoother';
import type { EraserMode } from '../store';

/**
 * Eraser session that tracks the entire erase gesture from pointer down to up
 */
interface EraserSession {
    id: string;
    mode: EraserMode;
    radius: number;
    path: { x: number; y: number }[]; // Path in page-space coordinates (normalized)
    pathBBox: { minX: number; minY: number; maxX: number; maxY: number } | null;
    candidates: Set<string>; // IDs of annotations that intersect
    startTime: number;
    deletedAnnotations: Annotation[]; // Store for undo
    createdAnnotations: Annotation[]; // Store splits for undo
}

export class EraserTool extends BaseTool {
    private quadtree: AnnotationQuadtree;
    private onEraseCallback: (deletes: string[], creates: Annotation[]) => void;
    private pageWidth: number;
    private pageHeight: number;
    private eraserRadius = 20; // Screen pixels
    private eraserRadiusPageSpace = 0; // Normalized radius in page coordinates
    private mode: EraserMode;
    private currentPointer: { x: number, y: number } | null = null;
    private activeSession: EraserSession | null = null;
    private rafId: number | null = null;
    private allAnnotations: Annotation[] = []; // We need access to all annotations for undo

    constructor(
        pageWidth: number,
        pageHeight: number,
        quadtree: AnnotationQuadtree,
        onErase: (deletes: string[], creates: Annotation[]) => void,
        mode: EraserMode = 'stroke',
        allAnnotations: Annotation[] = []
    ) {
        super();
        this.pageWidth = pageWidth;
        this.pageHeight = pageHeight;
        this.quadtree = quadtree;
        this.onEraseCallback = onErase;
        this.mode = mode;
        this.allAnnotations = allAnnotations;
        this.updateEraserRadiusPageSpace();
    }

    updatePageDimensions(width: number, height: number): void {
        this.pageWidth = width;
        this.pageHeight = height;
        this.updateEraserRadiusPageSpace();
    }

    updateQuadtree(quadtree: AnnotationQuadtree): void {
        this.quadtree = quadtree;
    }

    updateAnnotations(annotations: Annotation[]): void {
        this.allAnnotations = annotations;
    }

    setMode(mode: EraserMode): void {
        this.mode = mode;
    }

    setRadius(radius: number): void {
        this.eraserRadius = radius;
        this.updateEraserRadiusPageSpace();
    }

    private updateEraserRadiusPageSpace(): void {
        // Convert screen-space radius to normalized page-space
        this.eraserRadiusPageSpace = this.eraserRadius / Math.min(this.pageWidth, this.pageHeight);
    }

    onPointerDown(state: PointerState, _ctx: CanvasRenderingContext2D): void {
        this.isDrawing = true;
        this.currentPointer = { x: state.x, y: state.y };

        // Convert to page-space coordinates
        const pagePoint = normalizePoint(state.x, state.y, this.pageWidth, this.pageHeight);

        // Create new eraser session
        this.activeSession = {
            id: crypto.randomUUID(),
            mode: this.mode,
            radius: this.eraserRadiusPageSpace,
            path: [{ x: pagePoint.x, y: pagePoint.y }],
            pathBBox: null,
            candidates: new Set(),
            startTime: Date.now(),
            deletedAnnotations: [],
            createdAnnotations: []
        };

        // Update bbox
        this.updatePathBBox(this.activeSession);

        // Start RAF loop for processing
        this.startProcessingLoop();
    }

    onPointerMove(state: PointerState, ctx: CanvasRenderingContext2D): void {
        this.currentPointer = { x: state.x, y: state.y };

        if (this.isDrawing && this.activeSession) {
            // Convert to page-space and add point to eraser path
            const pagePoint = normalizePoint(state.x, state.y, this.pageWidth, this.pageHeight);

            // Downsample: only add if distance from last point is significant (~1.5px in page space)
            const lastPoint = this.activeSession.path[this.activeSession.path.length - 1];
            const dx = pagePoint.x - lastPoint.x;
            const dy = pagePoint.y - lastPoint.y;
            const distSq = dx * dx + dy * dy;
            const minDistSq = (1.5 / Math.min(this.pageWidth, this.pageHeight)) ** 2;

            if (distSq >= minDistSq) {
                this.activeSession.path.push({ x: pagePoint.x, y: pagePoint.y });
                this.updatePathBBox(this.activeSession);
            }
        }

        // Always render cursor (whether erasing or just hovering)
        this.render(ctx);
    }

    onPointerUp(state: PointerState, _ctx: CanvasRenderingContext2D): null {
        this.isDrawing = false;

        // Cancel RAF loop
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        if (this.activeSession) {
            // Add final point
            const pagePoint = normalizePoint(state.x, state.y, this.pageWidth, this.pageHeight);
            this.activeSession.path.push({ x: pagePoint.x, y: pagePoint.y });
            this.updatePathBBox(this.activeSession);

            // Process final candidates and commit changes
            this.commitSession(this.activeSession);

            // Clear session
            this.activeSession = null;
        }

        this.currentPointer = null;
        return null; // Eraser doesn't create annotations directly
    }

    private updatePathBBox(session: EraserSession): void {
        if (session.path.length === 0) {
            session.pathBBox = null;
            return;
        }

        let minX = session.path[0].x;
        let minY = session.path[0].y;
        let maxX = session.path[0].x;
        let maxY = session.path[0].y;

        for (const pt of session.path) {
            minX = Math.min(minX, pt.x);
            minY = Math.min(minY, pt.y);
            maxX = Math.max(maxX, pt.x);
            maxY = Math.max(maxY, pt.y);
        }

        // Expand by radius
        session.pathBBox = {
            minX: minX - session.radius,
            minY: minY - session.radius,
            maxX: maxX + session.radius,
            maxY: maxY + session.radius
        };
    }

    private startProcessingLoop(): void {
        if (this.rafId !== null) return;

        const loop = () => {
            if (!this.isDrawing || !this.activeSession) {
                this.rafId = null;
                return;
            }

            // Process candidates
            this.updateCandidates(this.activeSession);

            // Render preview - get the preview context from the canvas component
            // For now, we'll skip rendering in the RAF loop since we render on pointer move

            // Continue loop
            this.rafId = requestAnimationFrame(loop);
        };

        this.rafId = requestAnimationFrame(loop);
    }

    private updateCandidates(session: EraserSession): void {
        if (!session.pathBBox) return;

        // Layer 1: Query quadtree with expanded bbox
        const queryBox = {
            x: session.pathBBox.minX,
            y: session.pathBBox.minY,
            width: session.pathBBox.maxX - session.pathBBox.minX,
            height: session.pathBBox.maxY - session.pathBBox.minY
        };

        const potentialCandidates = this.quadtree.query(queryBox);

        // Filter: Test each candidate's bbox against eraser bbox first
        for (const candidate of potentialCandidates) {
            if (session.candidates.has(candidate.id)) continue; // Already marked

            // Layer 2: Bbox test
            const strokeBBox = this.getAnnotationBBox(candidate);
            if (!this.bboxIntersects(strokeBBox, session.pathBBox)) {
                continue; // Skip - bboxes don't intersect
            }

            // Layer 3: Detailed intersection test
            if (this.annotationIntersectsCapsule(candidate, session)) {
                session.candidates.add(candidate.id);
            }
        }
    }

    private getAnnotationBBox(annotation: Annotation): { minX: number; minY: number; maxX: number; maxY: number } {
        if (annotation.type === 'stroke' || (annotation.type === 'highlight' && annotation.geometry.mode === 'freehand')) {
            const points = annotation.type === 'stroke'
                ? annotation.geometry.points
                : annotation.geometry.path || [];

            if (points.length === 0) {
                return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            }

            let minX = points[0].x;
            let minY = points[0].y;
            let maxX = points[0].x;
            let maxY = points[0].y;

            for (const pt of points) {
                minX = Math.min(minX, pt.x);
                minY = Math.min(minY, pt.y);
                maxX = Math.max(maxX, pt.x);
                maxY = Math.max(maxY, pt.y);
            }

            return { minX, minY, maxX, maxY };
        } else if (annotation.type === 'shape' || annotation.type === 'text' || annotation.type === 'image' || annotation.type === 'math') {
            const bbox = annotation.geometry.boundingBox;
            return {
                minX: bbox.x,
                minY: bbox.y,
                maxX: bbox.x + bbox.width,
                maxY: bbox.y + bbox.height
            };
        } else if (annotation.type === 'highlight' && annotation.geometry.mode === 'text-aware') {
            const rects = annotation.geometry.rects || [];
            if (rects.length === 0) {
                return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            }

            let minX = rects[0].x;
            let minY = rects[0].y;
            let maxX = rects[0].x + rects[0].width;
            let maxY = rects[0].y + rects[0].height;

            for (const rect of rects) {
                minX = Math.min(minX, rect.x);
                minY = Math.min(minY, rect.y);
                maxX = Math.max(maxX, rect.x + rect.width);
                maxY = Math.max(maxY, rect.y + rect.height);
            }

            return { minX, minY, maxX, maxY };
        }

        return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    private bboxIntersects(
        a: { minX: number; minY: number; maxX: number; maxY: number },
        b: { minX: number; minY: number; maxX: number; maxY: number }
    ): boolean {
        return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
    }

    private annotationIntersectsCapsule(annotation: Annotation, session: EraserSession): boolean {
        if (annotation.type === 'stroke' || (annotation.type === 'highlight' && annotation.geometry.mode === 'freehand')) {
            const points = annotation.type === 'stroke'
                ? annotation.geometry.points
                : annotation.geometry.path || [];

            if (points.length < 2) return false;

            const r2 = session.radius * session.radius;

            // Check if any stroke point is within capsule
            for (const pt of points) {
                if (this.isPointInEraserCapsule(pt, session)) {
                    return true;
                }
            }

            // Check stroke segments (crucial - checks if stroke crosses capsule)
            for (let i = 0; i < points.length - 1; i++) {
                if (this.strokeSegmentIntersectsCapsule(points[i], points[i + 1], session, r2)) {
                    return true;
                }
            }
        } else if (annotation.type === 'shape' || annotation.type === 'image' || annotation.type === 'text' || annotation.type === 'math') {
            const bbox = annotation.geometry.boundingBox;

            // 1. Check corners (corners inside eraser)
            const corners = [
                { x: bbox.x, y: bbox.y },
                { x: bbox.x + bbox.width, y: bbox.y },
                { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
                { x: bbox.x, y: bbox.y + bbox.height }
            ];

            for (const corner of corners) {
                if (this.isPointInEraserCapsule(corner, session)) {
                    return true;
                }
            }

            // 2. Check if eraser path points are inside the bbox (eraser inside shape)
            for (const pt of session.path) {
                if (pt.x >= bbox.x && pt.x <= bbox.x + bbox.width &&
                    pt.y >= bbox.y && pt.y <= bbox.y + bbox.height) {
                    return true;
                }
            }
        } else if (annotation.type === 'highlight' && annotation.geometry.mode === 'text-aware') {
            const rects = annotation.geometry.rects || [];
            for (const rect of rects) {
                const corners = [
                    { x: rect.x, y: rect.y },
                    { x: rect.x + rect.width, y: rect.y },
                    { x: rect.x + rect.width, y: rect.y + rect.height },
                    { x: rect.x, y: rect.y + rect.height }
                ];

                for (const corner of corners) {
                    if (this.isPointInEraserCapsule(corner, session)) {
                        return true;
                    }
                }

                // Also check points inside
                for (const pt of session.path) {
                    if (pt.x >= rect.x && pt.x <= rect.x + rect.width &&
                        pt.y >= rect.y && pt.y <= rect.y + rect.height) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    private strokeSegmentIntersectsCapsule(
        segStart: { x: number; y: number },
        segEnd: { x: number; y: number },
        session: EraserSession,
        r2: number
    ): boolean {
        // Check if segment endpoints or midpoint are close to any eraser path segment
        for (let i = 0; i < session.path.length - 1; i++) {
            const eraserA = session.path[i];
            const eraserB = session.path[i + 1];

            // Check segment start against eraser segment
            if (this.pointToSegmentDistanceSquared(segStart, eraserA, eraserB) <= r2) {
                return true;
            }
            // Check segment end against eraser segment
            if (this.pointToSegmentDistanceSquared(segEnd, eraserA, eraserB) <= r2) {
                return true;
            }
            // Check segment midpoint for robustness
            const mid = {
                x: (segStart.x + segEnd.x) / 2,
                y: (segStart.y + segEnd.y) / 2
            };
            if (this.pointToSegmentDistanceSquared(mid, eraserA, eraserB) <= r2) {
                return true;
            }
        }

        return false;
    }

    private isPointInEraserCapsule(point: { x: number; y: number }, session: EraserSession): boolean {
        // 0) Fast bbox reject
        if (session.pathBBox) {
            if (point.x < session.pathBBox.minX || point.x > session.pathBBox.maxX ||
                point.y < session.pathBBox.minY || point.y > session.pathBBox.maxY) {
                return false;
            }
        }

        const r2 = session.radius * session.radius;

        // 1) Distance to every center sample
        for (const c of session.path) {
            const dx = point.x - c.x;
            const dy = point.y - c.y;
            if (dx * dx + dy * dy <= r2) {
                return true;
            }
        }

        // 2) Distance to each segment in the eraser path
        for (let i = 0; i + 1 < session.path.length; i++) {
            const a = session.path[i];
            const b = session.path[i + 1];
            if (this.pointToSegmentDistanceSquared(point, a, b) <= r2) {
                return true;
            }
        }

        return false;
    }

    /**
     * THE ONE FORMULA - exact implementation from specification
     * Calculate squared distance from a point to a line segment
     */
    private pointToSegmentDistanceSquared(
        p: { x: number; y: number },
        a: { x: number; y: number },
        b: { x: number; y: number }
    ): number {
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const wx = p.x - a.x;
        const wy = p.y - a.y;

        const c1 = vx * wx + vy * wy;
        if (c1 <= 0) {
            // Closest to a
            return wx * wx + wy * wy;
        }

        const c2 = vx * vx + vy * vy;
        if (c2 <= c1) {
            // Closest to b
            const dx = p.x - b.x;
            const dy = p.y - b.y;
            return dx * dx + dy * dy;
        }

        // Projection parameter 0..1
        const t = c1 / c2;
        const projX = a.x + t * vx;
        const projY = a.y + t * vy;

        const dx = p.x - projX;
        const dy = p.y - projY;
        return dx * dx + dy * dy;
    }

    private commitSession(session: EraserSession): void {
        const deletedIds: string[] = [];
        const createdAnnotations: Annotation[] = [];

        if (session.mode === 'stroke') {
            // Simple deletion mode - delete entire intersecting objects
            session.candidates.forEach(id => {
                deletedIds.push(id);
                const ann = this.allAnnotations.find(a => a.id === id);
                if (ann) session.deletedAnnotations.push(ann);
            });
        } else if (session.mode === 'point') {
            // Point eraser - split strokes using keep-ranges approach
            session.candidates.forEach(id => {
                const annotation = this.allAnnotations.find(a => a.id === id);
                if (!annotation) return;

                if (annotation.type === 'stroke') {
                    const segments = this.splitStrokeByKeepRanges(annotation as StrokeAnnotation, session);

                    if (segments.length === 0) {
                        // Fully erased
                        deletedIds.push(id);
                        session.deletedAnnotations.push(annotation);
                    } else {
                        // Split into multiple segments
                        deletedIds.push(id);
                        session.deletedAnnotations.push(annotation);
                        createdAnnotations.push(...segments);
                        session.createdAnnotations.push(...segments);
                    }
                } else {
                    // For non-stroke annotations, just delete them in point mode
                    deletedIds.push(id);
                    session.deletedAnnotations.push(annotation);
                }
            });
        }

        // Apply changes via callback (this triggers batch operation)
        if (deletedIds.length > 0 || createdAnnotations.length > 0) {
            this.onEraseCallback(deletedIds, createdAnnotations);
        }
    }

    /**
     * Split a stroke using the keep-ranges approach
     * Scan points, mark keep/erase, build consecutive keep ranges into new strokes
     */
    private splitStrokeByKeepRanges(annotation: StrokeAnnotation, session: EraserSession): StrokeAnnotation[] {
        const points = annotation.geometry.points;
        if (points.length < 2) return [];

        // Step 1: Mark each point as keep or erase
        const keepFlags: boolean[] = new Array(points.length);
        for (let i = 0; i < points.length; i++) {
            keepFlags[i] = !this.isPointInEraserCapsule(points[i], session);
        }

        // Step 2: Build keep ranges (consecutive "keep" stretches)
        const keepRanges: Array<{ start: number; end: number }> = [];
        let rangeStart: number | null = null;

        for (let i = 0; i < keepFlags.length; i++) {
            if (keepFlags[i]) {
                if (rangeStart === null) {
                    rangeStart = i;
                }
            } else {
                if (rangeStart !== null) {
                    keepRanges.push({ start: rangeStart, end: i - 1 });
                    rangeStart = null;
                }
            }
        }

        if (rangeStart !== null) {
            keepRanges.push({ start: rangeStart, end: keepFlags.length - 1 });
        }

        // Step 3: Convert keep ranges to new stroke segments
        const segments: StrokeAnnotation[] = [];
        const minSegmentPoints = 2;

        for (const range of keepRanges) {
            const segmentPoints = points.slice(range.start, range.end + 1);

            if (segmentPoints.length < minSegmentPoints) {
                continue;
            }

            // Calculate total length
            let totalLength = 0;
            for (let i = 0; i < segmentPoints.length - 1; i++) {
                const dx = segmentPoints[i + 1].x - segmentPoints[i].x;
                const dy = segmentPoints[i + 1].y - segmentPoints[i].y;
                totalLength += Math.sqrt(dx * dx + dy * dy);
            }

            // Keep segments longer than radius (quality filter)
            if (totalLength >= session.radius * 0.5) {
                segments.push({
                    ...annotation,
                    id: crypto.randomUUID(),
                    geometry: { ...annotation.geometry, points: segmentPoints },
                    updatedAt: Date.now()
                });
            }
        }

        return segments;
    }

    render(ctx: CanvasRenderingContext2D): void {
        if (!this.currentPointer) return;

        ctx.save();

        // Draw eraser cursor (circle) - always visible
        ctx.beginPath();
        ctx.arc(this.currentPointer.x, this.currentPointer.y, this.eraserRadius, 0, Math.PI * 2);
        ctx.strokeStyle = this.mode === 'stroke' ? '#ff0000' : '#0000ff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Show center dot when erasing
        if (this.isDrawing) {
            ctx.beginPath();
            ctx.arc(this.currentPointer.x, this.currentPointer.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = this.mode === 'stroke' ? '#ff0000' : '#0000ff';
            ctx.fill();
        }

        // Draw eraser path/trail when actively erasing
        if (this.isDrawing && this.activeSession && this.activeSession.path.length > 1) {
            ctx.strokeStyle = this.mode === 'stroke' ? 'rgba(255, 0, 0, 0.15)' : 'rgba(0, 0, 255, 0.15)';
            ctx.lineWidth = this.eraserRadius * 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            ctx.beginPath();
            const firstPt = this.activeSession.path[0];
            const firstScreen = denormalizePoint(firstPt.x, firstPt.y, this.pageWidth, this.pageHeight);
            ctx.moveTo(firstScreen.x, firstScreen.y);

            for (let i = 1; i < this.activeSession.path.length; i++) {
                const pt = this.activeSession.path[i];
                const screen = denormalizePoint(pt.x, pt.y, this.pageWidth, this.pageHeight);
                ctx.lineTo(screen.x, screen.y);
            }

            ctx.stroke();
        }

        // Highlight candidate annotations
        if (this.activeSession && this.activeSession.candidates.size > 0) {
            ctx.strokeStyle = 'rgba(255, 100, 100, 0.8)';
            ctx.lineWidth = 3;
            ctx.setLineDash([5, 5]);

            this.activeSession.candidates.forEach(id => {
                const ann = this.allAnnotations.find(a => a.id === id);
                if (!ann) return;

                if (ann.type === 'stroke' || (ann.type === 'highlight' && ann.geometry.mode === 'freehand')) {
                    const points = ann.type === 'stroke' ? ann.geometry.points : ann.geometry.path || [];

                    if (points.length > 0) {
                        ctx.beginPath();
                        const first = denormalizePoint(points[0].x, points[0].y, this.pageWidth, this.pageHeight);
                        ctx.moveTo(first.x, first.y);

                        for (let i = 1; i < points.length; i++) {
                            const pt = denormalizePoint(points[i].x, points[i].y, this.pageWidth, this.pageHeight);
                            ctx.lineTo(pt.x, pt.y);
                        }

                        ctx.stroke();
                    }
                } else if (ann.type === 'shape' || ann.type === 'image' || ann.type === 'text' || ann.type === 'math') {
                    const bbox = ann.geometry.boundingBox;
                    const x = bbox.x * this.pageWidth;
                    const y = bbox.y * this.pageHeight;
                    const w = bbox.width * this.pageWidth;
                    const h = bbox.height * this.pageHeight;
                    ctx.strokeRect(x, y, w, h);
                }
            });

            ctx.setLineDash([]);
        }

        ctx.restore();
    }

    getCursor(): string {
        return 'none';
    }
}
