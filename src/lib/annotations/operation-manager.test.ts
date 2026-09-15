import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOperationToAnnotations } from '@/core/annotations/apply';
import { createAddOperation, createBatchOperation, createDeleteOperation } from '@/core/annotations/operations';
import { makeShape, strokeCovering } from '@/core/annotations/test-factories';
import type { Annotation } from '@/core/annotations/models';
import { applyOperationToPageDocument, createPageDocument } from '@/core/pages/document';
import { createMovePageOperation } from '@/core/annotations/operations';

vi.mock('./storage', () => ({
    annotationStorage: {
        saveOperation: vi.fn(async () => undefined),
        getOperationsByFile: vi.fn(async () => []),
        saveAnnotation: vi.fn(async () => undefined),
        deleteAnnotation: vi.fn(async () => undefined),
    },
}));

const box = { x: 0, y: 0, width: 0.5, height: 0.5 };

describe('OperationManager visible projection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('notifies the document with inverse and forward commands', async () => {
        const { OperationManager } = await import('./operation-manager');
        const manager = new OperationManager();
        const annotation = strokeCovering(box, 'stroke');
        const operation = createAddOperation(annotation, 'doc');
        let visible: Annotation[] = [annotation];
        manager.subscribe('doc', command => { visible = applyOperationToAnnotations(visible, command); });

        await manager.addOperation(operation);
        await manager.undoLocal('doc');
        expect(visible).toEqual([]);
        await manager.redoLocal('doc');
        expect(visible).toEqual([annotation]);
    });

    it('undoes a whole eraser gesture as one batch', async () => {
        const { OperationManager } = await import('./operation-manager');
        const manager = new OperationManager();
        const original = strokeCovering(box, 'original');
        const left = makeShape({ ...box, width: 0.2 }, 'left');
        const right = makeShape({ ...box, x: 0.3 }, 'right');
        const batch = createBatchOperation([
            createDeleteOperation(original, 'doc'),
            createAddOperation(left, 'doc'),
            createAddOperation(right, 'doc'),
        ], 'doc');
        let visible = applyOperationToAnnotations([original], batch);
        manager.subscribe('doc', command => { visible = applyOperationToAnnotations(visible, command); });

        await manager.addOperation(batch);
        await manager.undoLocal('doc');
        expect(visible).toEqual([original]);
    });

    it('uses the same history for page operations', async () => {
        const { OperationManager } = await import('./operation-manager');
        const manager = new OperationManager();
        const page = (id: string) => ({ id, kind: 'blank' as const, width: 100, height: 200, rotation: 0 as const });
        const initial = createPageDocument([page('a'), page('b')]);
        const operation = createMovePageOperation('a', 0, 1, 'doc');
        let visible = applyOperationToPageDocument(initial, operation);
        manager.subscribe('doc', command => { visible = applyOperationToPageDocument(visible, command); });

        await manager.addOperation(operation);
        await manager.undoLocal('doc');
        expect(visible).toEqual(initial);
        await manager.redoLocal('doc');
        expect(visible.pages.map(item => item.id)).toEqual(['b', 'a']);
    });
});
