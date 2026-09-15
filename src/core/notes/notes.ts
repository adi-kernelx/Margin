import type { BoundingBox, HighlightAnnotation, TextHighlightRect } from '@/core/annotations/models';

const CONTEXT_LENGTH = 48;

export function unionHighlightBounds(highlight: HighlightAnnotation): BoundingBox {
    const rects: TextHighlightRect[] = highlight.geometry.rects
        ?? (highlight.geometry.path?.map(point => ({ x: point.x, y: point.y, width: 0, height: 0 })) ?? []);
    if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
    const x = Math.min(...rects.map(rect => rect.x));
    const y = Math.min(...rects.map(rect => rect.y));
    const right = Math.max(...rects.map(rect => rect.x + rect.width));
    const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
    return { x, y, width: right - x, height: bottom - y };
}

export function createHighlightNote(
    highlight: HighlightAnnotation,
    quote = '',
    pageText = '',
): NonNullable<HighlightAnnotation['note']> {
    const normalizedQuote = quote.replace(/\s+/g, ' ').trim();
    const normalizedPageText = pageText.replace(/\s+/g, ' ').trim();
    const matchIndex = normalizedQuote ? normalizedPageText.indexOf(normalizedQuote) : -1;
    return {
        body: '',
        quote: normalizedQuote,
        prefix: matchIndex >= 0
            ? normalizedPageText.slice(Math.max(0, matchIndex - CONTEXT_LENGTH), matchIndex)
            : '',
        suffix: matchIndex >= 0
            ? normalizedPageText.slice(matchIndex + normalizedQuote.length, matchIndex + normalizedQuote.length + CONTEXT_LENGTH)
            : '',
        bbox: unionHighlightBounds(highlight),
        pageId: highlight.pageId,
    };
}

export function notesInDocumentOrder(highlights: HighlightAnnotation[]): HighlightAnnotation[] {
    return [...highlights].sort((a, b) => {
        const aBox = a.note?.bbox ?? unionHighlightBounds(a);
        const bBox = b.note?.bbox ?? unionHighlightBounds(b);
        return a.pageNum - b.pageNum || aBox.y - bBox.y || aBox.x - bBox.x;
    });
}

const yamlString = (value: string) => JSON.stringify(value);

export function exportNotesMarkdown(
    documentTitle: string,
    documentId: string,
    highlights: HighlightAnnotation[],
): string {
    const notes = notesInDocumentOrder(highlights).filter(highlight => highlight.note);
    const header = [
        '---',
        'type: margin-notes',
        `document: ${yamlString(documentTitle)}`,
        `document_id: ${yamlString(documentId)}`,
        `note_count: ${notes.length}`,
        '---',
        '',
        `# Notes — ${documentTitle}`,
        '',
    ];
    const sections = notes.flatMap((highlight, index) => {
        const note = highlight.note!;
        const target = `margin://document/${encodeURIComponent(documentId)}?pageId=${encodeURIComponent(highlight.pageId ?? '')}&x=${note.bbox.x.toFixed(4)}&y=${note.bbox.y.toFixed(4)}`;
        return [
            `## ${index + 1}. Page ${highlight.pageNum}`,
            '',
            note.quote ? `> ${note.quote.replace(/\n/g, '\n> ')}` : '> Freehand highlight',
            '',
            note.body.trim() || '_No note text._',
            '',
            `[Open anchor](${target})`,
            '',
        ];
    });
    return [...header, ...sections].join('\n');
}
