// Command factories for the annotation operation log.
//
// Pure by construction: this module must not import storage, the DOM, or
// anything else with a side effect. That constraint is what makes undo
// semantics testable without a browser — it used to live next to
// OperationLog, which opens IndexedDB at import time, and the round-trip tests
// could not run at all.
//
// Every operation carries its own inverse, so undo is a matter of applying
// `op.inverse` rather than reconstructing what the operation did.

import type { Annotation, Operation } from './models';
import type { PageRecord, PageRotation } from '@/core/pages/models';
import type { DocumentNote } from '@/core/notes/models';

let counter = 0;

/** Monotonic within a session; the counter removes the same-millisecond collision Date.now() alone allows. */
function operationId(): string {
    counter += 1;
    return `op-${Date.now()}-${counter}`;
}

export function createAddOperation(annotation: Annotation, docId: string): Operation {
    return {
        id: operationId(),
        docId,
        type: 'add-annotation',
        timestamp: Date.now(),
        data: { annotation },
        inverse: {
            id: operationId(),
            docId,
            type: 'delete-annotation',
            timestamp: Date.now(),
            data: { id: annotation.id },
        },
    };
}

export function createUpdateOperation(
    annotation: Annotation,
    previousState: Annotation,
    docId: string
): Operation {
    return {
        id: operationId(),
        docId,
        type: 'update-annotation',
        timestamp: Date.now(),
        data: { annotation },
        inverse: {
            id: operationId(),
            docId,
            type: 'update-annotation',
            timestamp: Date.now(),
            data: { annotation: previousState },
        },
    };
}

export function createDeleteOperation(annotation: Annotation, docId: string): Operation {
    return {
        id: operationId(),
        docId,
        type: 'delete-annotation',
        timestamp: Date.now(),
        data: { id: annotation.id },
        inverse: {
            id: operationId(),
            docId,
            type: 'add-annotation',
            timestamp: Date.now(),
            data: { annotation },
        },
    };
}

export function createAddPageOperation(page: PageRecord, index: number, docId: string): Operation {
    return {
        id: operationId(), docId, type: 'add-page', timestamp: Date.now(), data: { page, index },
        inverse: {
            id: operationId(), docId, type: 'delete-page', timestamp: Date.now(), data: { pageId: page.id },
        },
    };
}

export function createDeletePageOperation(page: PageRecord, index: number, docId: string): Operation {
    return {
        id: operationId(), docId, type: 'delete-page', timestamp: Date.now(), data: { pageId: page.id },
        inverse: {
            id: operationId(), docId, type: 'add-page', timestamp: Date.now(), data: { page, index },
        },
    };
}

export function createMovePageOperation(pageId: string, fromIndex: number, toIndex: number, docId: string): Operation {
    return {
        id: operationId(), docId, type: 'move-page', timestamp: Date.now(), data: { pageId, toIndex },
        inverse: {
            id: operationId(), docId, type: 'move-page', timestamp: Date.now(), data: { pageId, toIndex: fromIndex },
        },
    };
}

export function createRotatePageOperation(
    pageId: string,
    rotation: PageRotation,
    previousRotation: PageRotation,
    docId: string,
): Operation {
    return {
        id: operationId(), docId, type: 'rotate-page', timestamp: Date.now(), data: { pageId, rotation },
        inverse: {
            id: operationId(), docId, type: 'rotate-page', timestamp: Date.now(),
            data: { pageId, rotation: previousRotation },
        },
    };
}

export function createAddNoteOperation(note: DocumentNote, docId: string): Operation {
    return {
        id: operationId(), docId, type: 'add-note', timestamp: Date.now(), data: { note },
        inverse: { id: operationId(), docId, type: 'delete-note', timestamp: Date.now(), data: { id: note.id } },
    };
}

export function createUpdateNoteOperation(note: DocumentNote, previous: DocumentNote, docId: string): Operation {
    return {
        id: operationId(), docId, type: 'update-note', timestamp: Date.now(), data: { note },
        inverse: { id: operationId(), docId, type: 'update-note', timestamp: Date.now(), data: { note: previous } },
    };
}

export function createDeleteNoteOperation(note: DocumentNote, docId: string): Operation {
    return {
        id: operationId(), docId, type: 'delete-note', timestamp: Date.now(), data: { id: note.id },
        inverse: { id: operationId(), docId, type: 'add-note', timestamp: Date.now(), data: { note } },
    };
}

export function createBatchOperation(operations: Operation[], docId: string): Operation {
    // A batch is only undoable if every member is. Dropping the ones that
    // aren't would produce an inverse that undoes part of the batch and leaves
    // the document in a state the user never created, which is worse than
    // refusing the operation outright.
    const missing = operations.filter(op => !op.inverse);
    if (missing.length > 0) {
        throw new Error(
            `Cannot batch operations without inverses: ${missing.map(op => op.type).join(', ')}`,
        );
    }

    return {
        id: operationId(),
        docId,
        type: 'batch',
        timestamp: Date.now(),
        data: { operations },
        inverse: {
            id: operationId(),
            docId,
            type: 'batch',
            timestamp: Date.now(),
            data: {
                // Reversed: undoing a sequence means undoing its last step first.
                operations: operations.map(op => op.inverse!).reverse(),
            },
        },
    };
}
