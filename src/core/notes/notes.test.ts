import { describe, expect, it } from 'vitest';
import type { HighlightAnnotation } from '@/core/annotations/models';
import { createHighlightNote, exportNotesMarkdown, notesInDocumentOrder } from './notes';

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

describe('highlight notes', () => {
    it('captures quote context and a fallback bounding box', () => {
        const item = highlight('a', 1, 0.2);
        const note = createHighlightNote(item, 'central phrase', 'prefix words central phrase suffix words');
        expect(note).toMatchObject({ quote: 'central phrase', prefix: 'prefix words ', suffix: ' suffix words' });
        expect(note.bbox).toMatchObject({ x: 0.2, y: 0.2 });
        expect(note.bbox.width).toBeCloseTo(0.4);
        expect(note.bbox.height).toBeCloseTo(0.05);
    });

    it('orders notes by page then position', () => {
        expect(notesInDocumentOrder([
            highlight('late', 2, 0.1), highlight('bottom', 1, 0.8), highlight('top', 1, 0.2),
        ]).map(item => item.id)).toEqual(['top', 'bottom', 'late']);
    });

    it('exports portable Markdown with page anchors', () => {
        const item = highlight('a', 3, 0.2);
        item.note = { ...createHighlightNote(item, 'Euler identity', 'Euler identity'), body: 'Use $e^{i\\pi}+1=0$.' };
        const markdown = exportNotesMarkdown('Math.pdf', 'doc id', [item]);
        expect(markdown).toContain('type: margin-notes');
        expect(markdown).toContain('## 1. Page 3');
        expect(markdown).toContain('pageId=page-3');
        expect(markdown).toContain('Use $e^{i\\pi}+1=0$.');
    });
});
