import { describe, expect, it } from 'vitest';
import type { HighlightAnnotation } from '@/core/annotations/models';
import { createUpdateNoteOperation } from '@/core/annotations/operations';
import type { DocumentNote } from './models';
import {
    addAnchorToNote,
    applyOperationToNotes,
    createDocumentNote,
    createHighlightAnchorText,
    createHighlightNote,
    createNoteAnchor,
    exportNotesMarkdown,
    migrateHighlightNotes,
    notesInDocumentOrder,
    synchronizeNoteAnchors,
} from './notes';

const highlight = (id: string, pageNum: number, y: number): HighlightAnnotation => ({
    id,
    type: 'highlight',
    pageNum,
    pageId: `page-${pageNum}`,
    createdAt: 1,
    updatedAt: 1,
    zIndex: 1,
    locked: false,
    style: { color: '#ff0', opacity: 0.3 },
    meta: { tool: 'highlighter' },
    geometry: { mode: 'text-aware', rects: [{ x: 0.2, y, width: 0.4, height: 0.05 }] },
});

describe('independent notes', () => {
    it('captures quote context separately from creating a note', () => {
        const item = highlight('a', 1, 0.2);
        item.anchorText = createHighlightAnchorText('central phrase', 'prefix words central phrase suffix words');
        expect(createNoteAnchor(item)).toMatchObject({
            quote: 'central phrase', prefix: 'prefix words ', suffix: ' suffix words',
            bbox: { x: 0.2, y: 0.2 },
        });
    });

    it('groups several highlights under one note and deduplicates anchors', () => {
        const first = createNoteAnchor(highlight('a', 1, 0.2));
        const second = createNoteAnchor(highlight('b', 3, 0.4));
        const note = addAnchorToNote(addAnchorToNote(createDocumentNote('note', 1), first, 2), second, 3);
        expect(note.anchors.map(anchor => anchor.highlightId)).toEqual(['a', 'b']);
        expect(addAnchorToNote(note, first)).toBe(note);
    });

    it('migrates legacy embedded notes without creating notes for ordinary highlights', () => {
        const legacy = highlight('legacy', 2, 0.3);
        legacy.note = { ...createHighlightNote(legacy, 'Euler identity', 'Euler identity'), body: 'Remember this.' };
        const plain = highlight('plain', 1, 0.1);
        const migrated = migrateHighlightNotes([legacy, plain]);
        expect(migrated.notes).toHaveLength(1);
        expect(migrated.notes[0]).toMatchObject({ id: 'note-legacy', body: 'Remember this.' });
        expect(migrated.notes[0].anchors[0].highlightId).toBe('legacy');
        expect((migrated.annotations[0] as HighlightAnnotation).note).toBeUndefined();
    });

    it('orders notes by their first document anchor and leaves empty notes last', () => {
        const makeNote = (id: string, item?: HighlightAnnotation): DocumentNote => ({
            ...createDocumentNote(id, id === 'empty' ? 0 : 1),
            anchors: item ? [createNoteAnchor(item)] : [],
        });
        expect(notesInDocumentOrder([
            makeNote('late', highlight('late-h', 2, 0.1)),
            makeNote('empty'),
            makeNote('bottom', highlight('bottom-h', 1, 0.8)),
            makeNote('top', highlight('top-h', 1, 0.2)),
        ]).map(item => item.id)).toEqual(['top', 'bottom', 'late', 'empty']);
    });

    it('updates note edits through the same reversible operation model', () => {
        const before = createDocumentNote('note', 1);
        const after = { ...before, body: 'Changed', updatedAt: 2 };
        const operation = createUpdateNoteOperation(after, before, 'doc');
        expect(applyOperationToNotes([before], operation)).toEqual([after]);
        expect(applyOperationToNotes([after], operation.inverse!)).toEqual([before]);
    });

    it('synchronizes anchors after a page move and removes missing highlights', () => {
        const first = highlight('a', 1, 0.2);
        const missing = highlight('missing', 2, 0.3);
        const note = { ...createDocumentNote('note', 1), anchors: [createNoteAnchor(first), createNoteAnchor(missing)] };
        const moved = { ...first, pageNum: 4, pageId: 'page-4' };
        expect(synchronizeNoteAnchors([note], [moved])[0].anchors).toMatchObject([
            { highlightId: 'a', pageNum: 4, pageId: 'page-4' },
        ]);
    });

    it('exports one Markdown section with every anchor in a grouped note', () => {
        const first = highlight('a', 1, 0.2);
        first.anchorText = createHighlightAnchorText('First quote', 'First quote');
        const second = highlight('b', 3, 0.4);
        second.anchorText = createHighlightAnchorText('Second quote', 'Second quote');
        const note = {
            ...createDocumentNote('note', 1),
            body: 'Use $e^{i\\pi}+1=0$.',
            anchors: [createNoteAnchor(first), createNoteAnchor(second)],
        };
        const markdown = exportNotesMarkdown('Math.pdf', 'doc id', [note]);
        expect(markdown).toContain('note_count: 1');
        expect(markdown.match(/^## /gm)).toHaveLength(1);
        expect(markdown).toContain('Page 1: First quote');
        expect(markdown).toContain('Page 3: Second quote');
        expect(markdown).toContain('Use $e^{i\\pi}+1=0$.');
    });
});
