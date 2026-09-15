import type { HighlightAnnotation, StrokeAnnotation } from '@/core/annotations/models';

type InkAnnotation = StrokeAnnotation | HighlightAnnotation;

interface RenderMessage {
    type: 'render-ink';
    requestId: number;
    annotations: InkAnnotation[];
    width: number;
    height: number;
    dpr: number;
}

function drawStroke(ctx: OffscreenCanvasRenderingContext2D, annotation: StrokeAnnotation, width: number, height: number): void {
    const curves = annotation.geometry.beziers;
    const points = annotation.geometry.points;
    const first = curves?.[0]?.start || points[0];
    if (!first) return;
    ctx.save();
    ctx.strokeStyle = annotation.style.color;
    ctx.globalAlpha = annotation.style.opacity;
    ctx.lineWidth = annotation.style.width || 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(first.x * width, first.y * height);
    if (curves?.length) {
        for (const curve of curves) ctx.bezierCurveTo(
            curve.control1.x * width,
            curve.control1.y * height,
            curve.control2.x * width,
            curve.control2.y * height,
            curve.end.x * width,
            curve.end.y * height,
        );
    } else {
        for (const point of points.slice(1)) ctx.lineTo(point.x * width, point.y * height);
    }
    ctx.stroke();
    ctx.restore();
}

function drawHighlight(ctx: OffscreenCanvasRenderingContext2D, annotation: HighlightAnnotation, width: number, height: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = annotation.style.opacity;
    ctx.strokeStyle = annotation.style.color;
    ctx.fillStyle = annotation.style.color;
    if (annotation.geometry.mode === 'freehand') {
        const points = annotation.geometry.path || [];
        if (points.length > 0) {
            ctx.lineWidth = annotation.style.width || 12;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(points[0].x * width, points[0].y * height);
            for (const point of points.slice(1)) ctx.lineTo(point.x * width, point.y * height);
            ctx.stroke();
        }
    } else {
        for (const rect of annotation.geometry.rects || []) {
            ctx.fillRect(rect.x * width, rect.y * height, rect.width * width, rect.height * height);
        }
    }
    ctx.restore();
}

self.onmessage = (event: MessageEvent<RenderMessage>) => {
    if (event.data.type !== 'render-ink') return;
    const { requestId, annotations, width, height, dpr } = event.data;
    try {
        const canvas = new OffscreenCanvas(Math.ceil(width * dpr), Math.ceil(height * dpr));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Offscreen 2D rendering is unavailable');
        ctx.scale(dpr, dpr);
        for (const annotation of annotations.filter(item => item.type === 'highlight')) drawHighlight(ctx, annotation, width, height);
        for (const annotation of annotations.filter(item => item.type === 'stroke')) drawStroke(ctx, annotation, width, height);
        const bitmap = canvas.transferToImageBitmap();
        self.postMessage({ type: 'ink-rendered', requestId, bitmap });
    } catch (error) {
        self.postMessage({ type: 'error', requestId, error: error instanceof Error ? error.message : String(error) });
    }
};
