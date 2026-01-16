export type TextSpan = {
    docId: string;
    page: number;
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    source: "native" | "ocr";
    confidence?: number;
};

export function mergeTextLayers(
    nativeSpans: TextSpan[],
    ocrSpans: TextSpan[]
): TextSpan[] {
    const result: TextSpan[] = [];

    for (const span of nativeSpans) {
        result.push(span);
    }

    for (const ocr of ocrSpans) {
        const overlap = nativeSpans.some(n =>
            iou(n.bbox, ocr.bbox) > 0.6 &&
            normalize(n.text) === normalize(ocr.text)
        );

        if (!overlap) {
            result.push(ocr);
        }
    }

    return result.sort(readingOrder);
}

function normalize(t: string) {
    return t.toLowerCase().replace(/\s+/g, " ").trim();
}

function iou(a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }) {
    const xA = Math.max(a.x0, b.x0);
    const yA = Math.max(a.y0, b.y0);
    const xB = Math.min(a.x1, b.x1);
    const yB = Math.min(a.y1, b.y1);
    const inter = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
    const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
    return inter / (areaA + areaB - inter + 1e-6);
}

function readingOrder(a: TextSpan, b: TextSpan) {
    if (Math.abs(a.bbox.y0 - b.bbox.y0) > 0.01) {
        return a.bbox.y0 - b.bbox.y0;
    }
    return a.bbox.x0 - b.bbox.x0;
}
