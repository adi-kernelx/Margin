import { describe, it, expect } from 'vitest';
import {
    createAddOperation,
    createUpdateOperation,
    createDeleteOperation,
    createBatchOperation,
} from './operations';
import { strokeCovering, makeShape } from './test-factories';
import type { Operation } from './models';

const DOC = 'doc-1';
const box = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };

/**
 * A pure model of what applying an operation means, mirroring the switch in
 * OperationLog.applyOperation but over an in-memory map instead of IndexedDB.
 *
 * This is what lets the round-trip property below be stated at all: undo is only
 * correct if applying an operation and then its inverse is indistinguishable
 * from having done nothing.
 */
type Doc = Map<string, unknown>;

function apply(doc: Doc, op: Operation): Doc {
    const next = new Map(doc);
    switch (op.type) {
        case 'add-annotation':
        case 'update-annotation':
            next.set(op.data.annotation.id, op.data.annotation);
            break;
        case 'delete-annotation':
            next.delete(op.data.id);
            break;
        case 'split-stroke':
            next.delete(op.data.originalId);
            for (const seg of op.data.segments) next.set(seg.id, seg);
            break;
        case 'batch':
            return op.data.operations.reduce(apply, next);
    }
    return next;
}

function docOf(entries: { id: string }[]): Doc {
    return new Map(entries.map((a) => [a.id, a]));
}

/** Asserts the inverse has the expected type and narrows it for the caller. */
function inverseOf<T extends Operation['type']>(op: Operation, type: T): Extract<Operation, { type: T }> {
    expect(op.inverse?.type).toBe(type);
    return op.inverse as Extract<Operation, { type: T }>;
}

function roundTrips(before: Doc, op: Operation): void {
    expect(op.inverse).toBeDefined();
    const after = apply(before, op);
    const restored = apply(after, op.inverse!);
    expect([...restored.entries()]).toEqual([...before.entries()]);
}

describe('operation inverses', () => {
    it('add inverts to a delete of the same annotation', () => {
        const a = strokeCovering(box, 'a1');
        const op = createAddOperation(a, DOC);

        expect(inverseOf(op, 'delete-annotation').data.id).toBe('a1');
        roundTrips(new Map(), op);
    });

    it('delete inverts to an add carrying the whole annotation back', () => {
        const a = strokeCovering(box, 'a1');
        const op = createDeleteOperation(a, DOC);

        expect(inverseOf(op, 'add-annotation').data.annotation).toEqual(a);
        roundTrips(docOf([a]), op);
    });

    it('update inverts to an update restoring the previous state', () => {
        const before = makeShape(box, 'a1');
        const after = { ...before, geometry: { boundingBox: { ...box, x: 0.9 } } };
        const op = createUpdateOperation(after, before, DOC);

        expect(inverseOf(op, 'update-annotation').data.annotation).toEqual(before);
        roundTrips(docOf([before]), op);
    });

    it('carries the doc id onto both the operation and its inverse', () => {
        const op = createAddOperation(strokeCovering(box), DOC);
        expect(op.docId).toBe(DOC);
        expect(op.inverse?.docId).toBe(DOC);
    });

    describe('batch', () => {
        it('inverts in reverse order', () => {
            // Order is the whole point: undoing "add A, then delete A" as
            // "add A, then delete A" reversed is the only sequence that lands
            // back where it started.
            const a = strokeCovering(box, 'a1');
            const ops = [createAddOperation(a, DOC), createDeleteOperation(a, DOC)];
            const batch = createBatchOperation(ops, DOC);

            const inverses = inverseOf(batch, 'batch').data.operations;
            expect(inverses.map((o) => o.type)).toEqual(['add-annotation', 'delete-annotation']);
            roundTrips(new Map(), batch);
        });

        it('round-trips a batch of independent adds', () => {
            const ops = ['a1', 'a2', 'a3'].map((id) => createAddOperation(strokeCovering(box, id), DOC));
            roundTrips(new Map(), createBatchOperation(ops, DOC));
        });

        it('round-trips a mixed batch against a populated document', () => {
            const kept = strokeCovering(box, 'kept');
            const doomed = strokeCovering(box, 'doomed');
            const added = makeShape(box, 'added');

            const batch = createBatchOperation(
                [createDeleteOperation(doomed, DOC), createAddOperation(added, DOC)],
                DOC,
            );
            roundTrips(docOf([kept, doomed]), batch);
        });

        it('refuses to batch a sub-operation that has no inverse', () => {
            // This previously filtered such sub-ops out, yielding a batch whose
            // undo applied only part of itself and left the document in a state
            // the user never created. Failing loudly is the only safe answer.
            const uninvertible: Operation = {
                id: 'op-raw',
                docId: DOC,
                type: 'add-annotation',
                timestamp: 0,
                data: { annotation: strokeCovering(box, 'orphan') },
            };

            expect(() => createBatchOperation([uninvertible], DOC)).toThrow(/without inverses/);
        });
    });
});
