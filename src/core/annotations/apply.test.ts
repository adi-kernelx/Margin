import { describe, expect, it } from 'vitest';
import { applyOperationToAnnotations } from './apply';
import { createAddOperation, createBatchOperation, createDeleteOperation } from './operations';
import { makeShape, strokeCovering } from './test-factories';

const box = { x: 0, y: 0, width: 0.5, height: 0.5 };

describe('applyOperationToAnnotations', () => {
    it('applies an operation and its inverse to the visible projection', () => {
        const annotation = strokeCovering(box, 'stroke');
        const add = createAddOperation(annotation, 'doc');
        const added = applyOperationToAnnotations([], add);
        expect(added).toEqual([annotation]);
        expect(applyOperationToAnnotations(added, add.inverse!)).toEqual([]);
    });

    it('applies an eraser batch atomically', () => {
        const original = strokeCovering(box, 'original');
        const left = makeShape({ ...box, width: 0.2 }, 'left');
        const right = makeShape({ ...box, x: 0.3, width: 0.2 }, 'right');
        const batch = createBatchOperation([
            createDeleteOperation(original, 'doc'),
            createAddOperation(left, 'doc'),
            createAddOperation(right, 'doc'),
        ], 'doc');
        const split = applyOperationToAnnotations([original], batch);
        expect(split.map(item => item.id)).toEqual(['left', 'right']);
        expect(applyOperationToAnnotations(split, batch.inverse!)).toEqual([original]);
    });
});
