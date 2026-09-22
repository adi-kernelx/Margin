import type { Annotation, BoundingBox, HighlightAnnotation, Operation, TextHighlightRect } from '@/core/annotations/models';
import type { DocumentNote, NoteAnchor } from './models';

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

export function createHighlightAnchorText(quote = '', pageText = ''): HighlightAnnotation['anchorText'] {
    const normalizedQuote = quote.replace(/\s+/g, ' ').trim();
    const normalizedPageText = pageText.replace(/\s+/g, ' ').trim();
    const matchIndex = normalizedQuote ? normalizedPageText.indexOf(normalizedQuote) : -1;
    return {
        quote: normalizedQuote,
        prefix: matchIndex >= 0
            ? normalizedPageText.slice(Math.max(0, matchIndex - CONTEXT_LENGTH), matchIndex)
            : '',
        suffix: matchIndex >= 0
            ? normalizedPageText.slice(matchIndex + normalizedQuote.length, matchIndex + normalizedQuote.length + CONTEXT_LENGTH)
            : '',
    };
}

export function createNoteAnchor(highlight: HighlightAnnotation): NoteAnchor {
    const text = highlight.anchorText ?? highlight.note ?? { quote: '', prefix: '', suffix: '' };
    return {
        id: `anchor-${highlight.id}`,
        highlightId: highlight.id,
        pageNum: highlight.pageNum,
        pageId: highlight.pageId,
        quote: text.quote,
        prefix: text.prefix,
        suffix: text.suffix,
        bbox: highlight.note?.bbox ?? unionHighlightBounds(highlight),
    };
}

export function createDocumentNote(id: string, now = Date.now()): DocumentNote {
    return { id, body: '', anchors: [], createdAt: now, updatedAt: now };
}

export function addAnchorToNote(note: DocumentNote, anchor: NoteAnchor, now = Date.now()): DocumentNote {
    if (note.anchors.some(item => item.highlightId === anchor.highlightId)) return note;
    return { ...note, anchors: [...note.anchors, anchor], updatedAt: now };
}

export function removeAnchorFromNote(note: DocumentNote, highlightId: string, now = Date.now()): DocumentNote {
    return { ...note, anchors: note.anchors.filter(anchor => anchor.highlightId !== highlightId), updatedAt: now };
}

export function migrateHighlightNotes(annotations: Annotation[]): { annotations: Annotation[]; notes: DocumentNote[] } {
    const notes: DocumentNote[] = [];
    const migrated = annotations.map(annotation => {
        if (annotation.type !== 'highlight' || !annotation.note) return annotation;
        const { note: legacy, ...highlight } = annotation;
        notes.push({
            id: `note-${annotation.id}`,
            body: legacy.body,
            anchors: [createNoteAnchor(annotation)],
            createdAt: annotation.createdAt,
            updatedAt: annotation.updatedAt,
        });
        return highlight as HighlightAnnotation;
    });
    return { annotations: migrated, notes };
}

export function notesInDocumentOrder(notes: DocumentNote[]): DocumentNote[] {
    return [...notes].sort((a, b) => {
        const aAnchor = [...a.anchors].sort(compareAnchors)[0];
        const bAnchor = [...b.anchors].sort(compareAnchors)[0];
        if (!aAnchor || !bAnchor) return aAnchor ? -1 : bAnchor ? 1 : a.createdAt - b.createdAt;
        return compareAnchors(aAnchor, bAnchor) || a.createdAt - b.createdAt;
    });
}

function compareAnchors(a: NoteAnchor, b: NoteAnchor): number {
    return a.pageNum - b.pageNum || a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x;
}

export function notesForHighlights(notes: DocumentNote[], highlightIds: Set<string>): DocumentNote[] {
    return notes.flatMap(note => {
        const anchors = note.anchors.filter(anchor => highlightIds.has(anchor.highlightId));
        return anchors.length ? [{ ...note, anchors }] : [];
    });
}

export function synchronizeNoteAnchors(notes: DocumentNote[], annotations: Annotation[]): DocumentNote[] {
    const highlights = new Map(
        annotations.filter((annotation): annotation is HighlightAnnotation => annotation.type === 'highlight')
            .map(highlight => [highlight.id, highlight]),
    );
    return notes.map(note => ({
        ...note,
        anchors: note.anchors.flatMap(anchor => {
            const highlight = highlights.get(anchor.highlightId);
            if (!highlight) return [];
            return [{
                ...anchor,
                pageNum: highlight.pageNum,
                pageId: highlight.pageId,
                bbox: unionHighlightBounds(highlight),
            }];
        }),
    }));
}

export function applyOperationToNotes(notes: DocumentNote[], operation: Operation): DocumentNote[] {
    if (operation.type === 'batch') return operation.data.operations.reduce(applyOperationToNotes, notes);
    if (operation.type === 'add-note') return notes.some(note => note.id === operation.data.note.id)
        ? notes
        : [...notes, operation.data.note];
    if (operation.type === 'update-note') return notes.map(note => note.id === operation.data.note.id ? operation.data.note : note);
    if (operation.type === 'delete-note') return notes.filter(note => note.id !== operation.data.id);
    return notes;
}

const yamlString = (value: string) => JSON.stringify(value);

export function exportNotesMarkdown(
    documentTitle: string,
    documentId: string,
    notes: DocumentNote[],
): string {
    const ordered = notesInDocumentOrder(notes);
    const header = [
        '---',
        'type: margin-notes',
        `document: ${yamlString(documentTitle)}`,
        `document_id: ${yamlString(documentId)}`,
        `note_count: ${ordered.length}`,
        '---',
        '',
        `# Notes — ${documentTitle}`,
        '',
    ];
    const sections = ordered.flatMap((note, index) => {
        const first = [...note.anchors].sort(compareAnchors)[0];
        const targets = note.anchors.flatMap((anchor, anchorIndex) => {
            const target = `margin://document/${encodeURIComponent(documentId)}?pageId=${encodeURIComponent(anchor.pageId ?? '')}&x=${anchor.bbox.x.toFixed(4)}&y=${anchor.bbox.y.toFixed(4)}`;
            return [
                `- Page ${anchor.pageNum}: ${anchor.quote || 'Highlighted region'} — [Open anchor ${anchorIndex + 1}](${target})`,
            ];
        });
        return [
            `## ${index + 1}. ${first ? `Page ${first.pageNum}` : 'Unanchored note'}`,
            '',
            note.body.trim() || '_No note text._',
            '',
            ...(targets.length ? ['### Anchors', '', ...targets, ''] : []),
            '',
        ];
    });
    return [...header, ...sections].join('\n');
}
