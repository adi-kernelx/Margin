
import type { Annotation, StrokeAnnotation, HighlightAnnotation, TextAnnotation, ShapeAnnotation, ImageAnnotation, MathAnnotation } from '@/lib/annotations/models';
import katex from 'katex';

// Helper to normalize/denormalize
const denormalizePoint = (
    x: number,
    y: number,
    pageWidth: number,
    pageHeight: number
): { x: number; y: number } => {
    return {
        x: x * pageWidth,
        y: y * pageHeight,
    };
};

const getBaseBox = (annotation: ShapeAnnotation | ImageAnnotation) => {
    return annotation.geometry.boundingBox;
};

const getTransform = (annotation: ShapeAnnotation | ImageAnnotation) => {
    // Default to identity but with translation from boundingBox if transform matches
    const t = annotation.geometry.transform;
    if (!t) {
        return {
            a: 1,
            b: 0,
            c: 0,
            d: 1,
            e: annotation.geometry.boundingBox.x,
            f: annotation.geometry.boundingBox.y
        };
    }
    return t;
};

export const renderPageAnnotationsToCanvas = async (
    canvas: HTMLCanvasElement,
    annotations: Annotation[],
    viewport: { width: number; height: number },
    exportScale: number = 2
): Promise<void> => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pageWidth = viewport.width;
    const pageHeight = viewport.height;

    // Set high-res dimensions
    canvas.width = Math.round(pageWidth * exportScale);
    canvas.height = Math.round(pageHeight * exportScale);

    // Reset and scale context
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(exportScale, exportScale);

    // Sort annotations by z-index or type
    // In AnnotationCanvas layer 2 (strokes/text) is below Layer 3 (images/shapes/math).
    // Actually Layer 3 is on top.
    // Z-index logic in AnnotationCanvas:
    // Stroke/Highlight/Text -> Layer 2
    // Image/Shape -> Layer 3
    // But within layers, they sort by standard order (creation?).
    // Let's sort simply by zIndex property if available, or maintain array order.
    // We should respect the visual layering: Highlights < Strokes < Text < Shapes < Images < Math
    // Or just iterate standard array order if that's how they are stored?
    // Storage order is usually creation order.
    // Canvas layers suggest:
    // Highlights should probably be blended?

    // Simplest approach: Divide into groups like AnnotationCanvas
    const strokes = annotations.filter(a => a.type === 'stroke');
    const highlights = annotations.filter(a => a.type === 'highlight');
    const texts = annotations.filter(a => a.type === 'text');
    const shapes = annotations.filter(a => a.type === 'shape');
    const images = annotations.filter(a => a.type === 'image');
    const maths = annotations.filter(a => a.type === 'math');

    // Draw Highlights first (bottom)
    for (const ann of highlights) {
        drawHighlight(ctx, ann as HighlightAnnotation, pageWidth, pageHeight);
    }

    // Draw Strokes
    for (const ann of strokes) {
        drawStroke(ctx, ann as StrokeAnnotation, pageWidth, pageHeight);
    }

    // Draw Text
    for (const ann of texts) {
        drawText(ctx, ann as TextAnnotation, pageWidth, pageHeight);
    }

    // Draw Shapes
    for (const ann of shapes) {
        drawShape(ctx, ann as ShapeAnnotation, pageWidth, pageHeight);
    }

    // Draw Images (Async)
    const imagePromises = images.map(ann => drawImageAnnotation(ctx, ann as ImageAnnotation, pageWidth, pageHeight));
    await Promise.all(imagePromises);

    // Draw Math (Async)
    const mathPromises = maths.map(ann => drawMath(ctx, ann as MathAnnotation, pageWidth, pageHeight));
    await Promise.all(mathPromises);
};

// --- Drawing Functions ---

const drawStroke = (ctx: CanvasRenderingContext2D, annotation: StrokeAnnotation, pageWidth: number, pageHeight: number) => {
    const points = annotation.geometry.points;
    const curves = annotation.geometry.beziers;
    if (points.length < 2 && !curves?.length) return;

    ctx.save();
    ctx.strokeStyle = annotation.style.color;
    ctx.lineWidth = annotation.style.width || 2;
    ctx.globalAlpha = annotation.style.opacity || 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    const firstPoint = curves?.[0]?.start || points[0];
    const first = denormalizePoint(firstPoint.x, firstPoint.y, pageWidth, pageHeight);
    ctx.moveTo(first.x, first.y);
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
            const p = denormalizePoint(points[i].x, points[i].y, pageWidth, pageHeight);
            ctx.lineTo(p.x, p.y);
        }
    }
    ctx.stroke();
    ctx.restore();
};

const drawHighlight = (ctx: CanvasRenderingContext2D, annotation: HighlightAnnotation, pageWidth: number, pageHeight: number) => {
    ctx.save();
    ctx.globalCompositeOperation = (annotation.style.blendMode as GlobalCompositeOperation) || 'multiply';

    const hex = annotation.style.color;
    // Helper to get rgba
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const alpha = annotation.style.opacity || 0.25;
    const rgba = `rgba(${r}, ${g}, ${b}, ${alpha})`;

    ctx.fillStyle = rgba;
    ctx.strokeStyle = rgba;

    if (annotation.geometry.mode === 'freehand' && annotation.geometry.path) {
        const points = annotation.geometry.path;
        if (points.length < 2) { ctx.restore(); return; }

        ctx.lineWidth = annotation.style.width || 12;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        const first = denormalizePoint(points[0].x, points[0].y, pageWidth, pageHeight);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < points.length; i++) {
            const p = denormalizePoint(points[i].x, points[i].y, pageWidth, pageHeight);
            ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
    } else if (annotation.geometry.mode === 'text-aware' && annotation.geometry.rects) {
        for (const rect of annotation.geometry.rects) {
            ctx.fillRect(
                rect.x * pageWidth,
                rect.y * pageHeight,
                rect.width * pageWidth,
                rect.height * pageHeight
            );
        }
    }
    ctx.restore();
};

const drawText = (ctx: CanvasRenderingContext2D, annotation: TextAnnotation, pageWidth: number, pageHeight: number) => {
    const bbox = annotation.geometry.boundingBox;
    const x = bbox.x * pageWidth;
    const y = bbox.y * pageHeight;
    const width = bbox.width * pageWidth;
    const height = bbox.height * pageHeight;

    ctx.save();

    // Background
    if (annotation.style.backgroundColor) {
        ctx.fillStyle = annotation.style.backgroundColor;
        ctx.fillRect(x, y, width, height);
    }

    const fontSize = annotation.style.fontSize || 16;
    const fontFamily = annotation.style.fontFamily || 'Arial';
    const bold = annotation.style.bold ? 'bold' : '';
    const italic = annotation.style.italic ? 'italic' : '';

    ctx.font = `${italic} ${bold} ${fontSize}px ${fontFamily}`.trim();
    ctx.fillStyle = annotation.style.color;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    // Wrap text
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

    const lineHeight = fontSize * 1.2;
    lines.forEach((line, index) => {
        const lineY = y + index * lineHeight;
        ctx.fillText(line, x, lineY);

        // Underline
        if (annotation.style.underline) {
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

const drawShape = (ctx: CanvasRenderingContext2D, annotation: ShapeAnnotation, pageWidth: number, pageHeight: number) => {
    const base = getBaseBox(annotation);
    const t = getTransform(annotation);

    ctx.save();
    // Transform
    ctx.transform(t.a, t.b, t.c, t.d, t.e * pageWidth, t.f * pageHeight);

    const width = base.width * pageWidth;
    const height = base.height * pageHeight;

    ctx.strokeStyle = annotation.style.color;
    ctx.lineWidth = annotation.style.width || 2;
    ctx.globalAlpha = annotation.style.opacity || 1;

    if (annotation.shapeType === 'rectangle') {
        ctx.strokeRect(0, 0, width, height);
    } else if (annotation.shapeType === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, 2 * Math.PI);
        ctx.stroke();
    } else if (annotation.shapeType === 'arrow' || annotation.shapeType === 'line') {
        const start = annotation.geometry.startPoint;
        const end = annotation.geometry.endPoint;
        if (start && end) {
            const sx = start.x * width;
            const sy = start.y * height;
            const ex = end.x * width;
            const ey = end.y * height;

            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.stroke();

            if (annotation.shapeType === 'arrow') {
                const angle = Math.atan2(ey - sy, ex - sx);
                const arrowLength = 15;
                const arrowAngle = Math.PI / 6;
                ctx.beginPath();
                ctx.moveTo(ex, ey);
                ctx.lineTo(ex - arrowLength * Math.cos(angle - arrowAngle), ey - arrowLength * Math.sin(angle - arrowAngle));
                ctx.moveTo(ex, ey);
                ctx.lineTo(ex - arrowLength * Math.cos(angle + arrowAngle), ey - arrowLength * Math.sin(angle + arrowAngle));
                ctx.stroke();
            }
        }
    }
    ctx.restore();
};

const drawImageAnnotation = async (ctx: CanvasRenderingContext2D, annotation: ImageAnnotation, pageWidth: number, pageHeight: number) => {
    return new Promise<void>((resolve) => {
        const base = getBaseBox(annotation);
        const t = getTransform(annotation);

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            ctx.save();
            ctx.transform(t.a, t.b, t.c, t.d, t.e * pageWidth, t.f * pageHeight);
            ctx.globalAlpha = annotation.style.opacity || 1;
            ctx.drawImage(img, 0, 0, base.width * pageWidth, base.height * pageHeight);
            ctx.restore();
            resolve();
        };
        img.onerror = () => {
            console.warn('Failed to load image for export');
            resolve();
        };
        img.src = annotation.imageData;
    });
};

const drawMath = async (ctx: CanvasRenderingContext2D, annotation: MathAnnotation, pageWidth: number, pageHeight: number) => {
    return new Promise<void>((resolve) => {
        const bbox = annotation.geometry.boundingBox;
        const x = bbox.x * pageWidth;
        const y = bbox.y * pageHeight;
        const width = bbox.width * pageWidth;
        const height = bbox.height * pageHeight;

        if (annotation.style.backgroundColor) {
            ctx.fillStyle = annotation.style.backgroundColor;
            ctx.fillRect(x, y, width, height);
        }

        const loadImg = (src: string) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                ctx.drawImage(img, x, y, width, height);
                resolve();
            };
            img.onerror = () => {
                console.warn("Math image load failed");
                resolve();
            }
            img.src = src;
        };

        if (annotation.svgDataUrl) {
            loadImg(annotation.svgDataUrl);
        } else {
            // Fallback render
            try {
                const mathml = katex.renderToString(annotation.content, {
                    displayMode: annotation.displayMode,
                    throwOnError: false,
                    output: 'mathml'
                });
                const svgContent = `
                <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
                    <foreignObject width="100%" height="100%">
                        <div xmlns="http://www.w3.org/1999/xhtml" style="font-size: ${annotation.style.fontSize}px; color: ${annotation.style.color}; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center;">
                             <style>math { color: ${annotation.style.color || 'black'}; font-family: serif; }</style>
                            ${mathml}
                        </div>
                    </foreignObject>
                </svg>`;
                const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                loadImg(url);
                // Note: we're not revoking URL here to keep simple async flow, browser handles it eventually or we leak small amount during save.
            } catch {
                resolve();
            }
        }
    });
};
