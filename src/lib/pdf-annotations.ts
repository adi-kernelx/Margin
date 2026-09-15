import {
    PDFArray,
    PDFDict,
    PDFDocument,
    PDFHexString,
    PDFName,
    PDFString,
    type PDFPage,
} from 'pdf-lib';
import type {
    Annotation,
    BoundingBox,
    HighlightAnnotation,
    Point,
    StrokePoint,
} from '@/core/annotations/models';

type PdfRect = [number, number, number, number];

function colorComponents(color: string): [number, number, number] {
    const match = color.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    if (!match) return [1, 0.84, 0];
    const hex = match[1].length === 3
        ? [...match[1]].map(value => value + value).join('')
        : match[1];
    return [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
}

function pdfRect(box: BoundingBox, width: number, height: number): PdfRect {
    return [
        box.x * width,
        (1 - box.y - box.height) * height,
        (box.x + box.width) * width,
        (1 - box.y) * height,
    ];
}

function pointsRect(points: StrokePoint[], width: number, height: number, padding: number): PdfRect {
    const xs = points.map(point => point.x * width);
    const ys = points.map(point => (1 - point.y) * height);
    return [
        Math.min(...xs) - padding,
        Math.min(...ys) - padding,
        Math.max(...xs) + padding,
        Math.max(...ys) + padding,
    ];
}

function pdfPoint(point: Point, width: number, height: number): [number, number] {
    return [point.x * width, (1 - point.y) * height];
}

function appendAnnotation(page: PDFPage, dictionary: PDFDict, annotationId: string) {
    const existing = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    const annots = existing ?? page.doc.context.obj([]);
    if (!existing) page.node.set(PDFName.of('Annots'), annots);
    for (let index = 0; index < annots.size(); index++) {
        const annotation = annots.lookupMaybe(index, PDFDict);
        const name = annotation?.lookup(PDFName.of('NM'));
        if ((name instanceof PDFString || name instanceof PDFHexString) && name.decodeText() === annotationId) return;
    }
    annots.push(page.doc.context.register(dictionary));
}

function common(annotation: Annotation, rect: PdfRect) {
    return {
        Type: 'Annot',
        Rect: rect,
        NM: PDFHexString.fromText(annotation.id),
        M: PDFHexString.fromText(new Date(annotation.updatedAt).toISOString()),
        F: 4,
        C: colorComponents(annotation.style.color),
        CA: annotation.style.opacity,
    };
}

function highlightDictionary(pdfDoc: PDFDocument, page: PDFPage, annotation: HighlightAnnotation): PDFDict | null {
    const { width, height } = page.getSize();
    const content = annotation.note?.body || annotation.note?.quote || '';
    if (annotation.geometry.mode === 'text-aware' && annotation.geometry.rects?.length) {
        const rectangles = annotation.geometry.rects;
        const union = rectangles.reduce<BoundingBox>((box, rect) => ({
            x: Math.min(box.x, rect.x),
            y: Math.min(box.y, rect.y),
            width: Math.max(box.x + box.width, rect.x + rect.width) - Math.min(box.x, rect.x),
            height: Math.max(box.y + box.height, rect.y + rect.height) - Math.min(box.y, rect.y),
        }), { ...rectangles[0] });
        const quadPoints = rectangles.flatMap(rect => {
            const [x1, y1, x2, y2] = pdfRect(rect, width, height);
            return [x1, y2, x2, y2, x1, y1, x2, y1];
        });
        return pdfDoc.context.obj({
            ...common(annotation, pdfRect(union, width, height)),
            Subtype: 'Highlight',
            QuadPoints: quadPoints,
            Contents: PDFHexString.fromText(content),
        });
    }

    const path = annotation.geometry.path;
    if (!path?.length) return null;
    const lineWidth = Math.max(1, annotation.style.width ?? 12);
    return pdfDoc.context.obj({
        ...common(annotation, pointsRect(path, width, height, lineWidth)),
        Subtype: 'Ink',
        InkList: [path.flatMap(point => pdfPoint(point, width, height))],
        BS: { W: lineWidth, S: 'S' },
        Contents: PDFHexString.fromText(content),
    });
}

/** Add interoperable PDF annotations while keeping Margin's richer model separate. */
export function addPdfAnnotations(pdfDoc: PDFDocument, annotations: Annotation[]): void {
    const pages = pdfDoc.getPages();
    for (const annotation of annotations) {
        const page = pages[annotation.pageNum - 1];
        if (!page || annotation.type === 'image') continue;
        const { width, height } = page.getSize();
        let dictionary: PDFDict | null = null;

        if (annotation.type === 'highlight') {
            dictionary = highlightDictionary(pdfDoc, page, annotation);
        } else if (annotation.type === 'stroke' && annotation.geometry.points.length) {
            const lineWidth = Math.max(0.5, annotation.style.width ?? 2);
            dictionary = pdfDoc.context.obj({
                ...common(annotation, pointsRect(annotation.geometry.points, width, height, lineWidth)),
                Subtype: 'Ink',
                InkList: [annotation.geometry.points.flatMap(point => pdfPoint(point, width, height))],
                BS: { W: lineWidth, S: 'S' },
            });
        } else if (annotation.type === 'text' || annotation.type === 'math') {
            const fontSize = annotation.style.fontSize ?? 12;
            dictionary = pdfDoc.context.obj({
                ...common(annotation, pdfRect(annotation.geometry.boundingBox, width, height)),
                Subtype: 'FreeText',
                Contents: PDFHexString.fromText(annotation.content),
                DA: PDFHexString.fromText(`/Helv ${fontSize} Tf 0 g`),
                Q: 0,
            });
        } else if (annotation.type === 'shape') {
            const lineWidth = Math.max(0.5, annotation.style.width ?? 2);
            const base = {
                ...common(annotation, pdfRect(annotation.geometry.boundingBox, width, height)),
                BS: { W: lineWidth, S: 'S' },
            };
            if ((annotation.shapeType === 'line' || annotation.shapeType === 'arrow')
                && annotation.geometry.startPoint && annotation.geometry.endPoint) {
                dictionary = pdfDoc.context.obj({
                    ...base,
                    Subtype: 'Line',
                    L: [
                        ...pdfPoint(annotation.geometry.startPoint, width, height),
                        ...pdfPoint(annotation.geometry.endPoint, width, height),
                    ],
                    LE: ['None', annotation.shapeType === 'arrow' ? 'ClosedArrow' : 'None'],
                });
            } else {
                dictionary = pdfDoc.context.obj({
                    ...base,
                    Subtype: annotation.shapeType === 'ellipse' ? 'Circle' : 'Square',
                });
            }
        }

        if (dictionary) appendAnnotation(page, dictionary, annotation.id);
    }
}
