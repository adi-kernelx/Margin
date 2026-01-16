import type { TextSpan } from "./text-builder";

export type Chunk = {
    chunkId: string;
    docId: string;
    page: number;
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    spanCount: number;
};

export function buildChunks(spans: TextSpan[], maxChars = 800): Chunk[] {
    const chunks: Chunk[] = [];
    let buffer: TextSpan[] = [];
    let textLen = 0;

    for (const span of spans) {
        buffer.push(span);
        textLen += span.text.length;

        if (textLen > maxChars) {
            chunks.push(makeChunk(buffer));
            buffer = [];
            textLen = 0;
        }
    }

    if (buffer.length) {
        chunks.push(makeChunk(buffer));
    }

    return chunks;
}

function makeChunk(spans: TextSpan[]): Chunk {
    const docId = spans[0].docId;
    const page = spans[0].page;

    const text = spans.map(s => s.text).join(" ");
    const bbox = unionBBox(spans.map(s => s.bbox));

    const chunkId = crypto.randomUUID();

    return {
        chunkId,
        docId,
        page,
        text,
        bbox,
        spanCount: spans.length
    };
}

function unionBBox(boxes: { x0: number; y0: number; x1: number; y1: number }[]) {
    return {
        x0: Math.min(...boxes.map(b => b.x0)),
        y0: Math.min(...boxes.map(b => b.y0)),
        x1: Math.max(...boxes.map(b => b.x1)),
        y1: Math.max(...boxes.map(b => b.y1))
    };
}
