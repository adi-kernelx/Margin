import { describe, expect, it } from 'vitest';
import {
    MIN_TEXT_EDITOR_HEIGHT,
    MIN_TEXT_EDITOR_WIDTH,
    canCommitTextEditor,
    createTextEditorSession,
    editTextEditorSession,
    growTextEditorToContent,
    moveTextEditor,
    resizeTextEditor,
    setTextEditorDraft,
    textEditorFrameToPageFrame,
} from './state';

const bounds = { width: 800, height: 600 };

describe('text editor session', () => {
    it('creates a bounded empty session', () => {
        const session = createTextEditorSession(
            { x: 760, y: 580, width: 200, height: 50 },
            bounds,
        );
        expect(session.mode).toBe('create');
        expect(session.draft).toBe('');
        expect(session.frame).toEqual({ x: 600, y: 536, width: 200, height: 64 });
    });

    it('keeps edit identity and draft text', () => {
        const session = editTextEditorSession(
            'text-1',
            'existing text',
            { x: 10, y: 20, width: 240, height: 90 },
            bounds,
        );
        expect(session).toMatchObject({
            mode: 'edit',
            annotationId: 'text-1',
            draft: 'existing text',
        });
    });

    it('clamps movement without changing size or content', () => {
        const original = setTextEditorDraft(
            createTextEditorSession({ x: 20, y: 20, width: 200, height: 80 }, bounds),
            'draft',
        );
        const moved = moveTextEditor(original, -50, 590, bounds);
        expect(moved.frame).toEqual({ x: 0, y: 520, width: 200, height: 80 });
        expect(moved.draft).toBe('draft');
    });

    it('enforces minimum and available resize bounds', () => {
        const original = createTextEditorSession(
            { x: 700, y: 500, width: 100, height: 100 },
            bounds,
        );
        const small = resizeTextEditor(original, 10, 10, bounds);
        expect(small.frame.width).toBe(MIN_TEXT_EDITOR_WIDTH);
        expect(small.frame.height).toBe(MIN_TEXT_EDITOR_HEIGHT);

        const large = resizeTextEditor(original, 500, 500, bounds);
        expect(large.frame).toMatchObject({ width: 120, height: 100 });
    });

    it('only grows for content and respects the page edge', () => {
        const original = createTextEditorSession(
            { x: 20, y: 500, width: 200, height: 64 },
            bounds,
        );
        expect(growTextEditorToContent(original, 40, bounds)).toBe(original);
        const pageEdge = growTextEditorToContent(original, 300, bounds);
        expect(pageEdge.frame.height).toBe(100);
        expect(growTextEditorToContent(pageEdge, 318, bounds)).toBe(pageEdge);
    });

    it('does not loop when the page bounds are not measurable yet', () => {
        const zeroBounds = { width: 0, height: 0 };
        const session = createTextEditorSession({ x: 0, y: 0, width: 200, height: 80 }, zeroBounds);
        expect(growTextEditorToContent(session, 80, zeroBounds)).toBe(session);
    });

    it('requires non-whitespace content before commit', () => {
        const original = createTextEditorSession(
            { x: 0, y: 0, width: 200, height: 80 },
            bounds,
        );
        expect(canCommitTextEditor(setTextEditorDraft(original, '   '))).toBe(false);
        expect(canCommitTextEditor(setTextEditorDraft(original, ' theorem '))).toBe(true);
    });

    it('converts the overlay frame into normalized page geometry', () => {
        expect(textEditorFrameToPageFrame(
            { x: 30, y: 40, width: 200, height: 100 },
            { x: 10, y: 10 },
            { width: 400, height: 200 },
        )).toEqual({ x: 0.05, y: 0.15, width: 0.5, height: 0.5 });
    });
});
