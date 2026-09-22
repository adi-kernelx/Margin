import type { Annotation, Operation } from './models';

/** Applies a typed command to the in-memory document projection used by React. */
export function applyOperationToAnnotations(
    annotations: Annotation[],
    operation: Operation,
): Annotation[] {
    switch (operation.type) {
        case 'add-annotation':
        case 'update-annotation': {
            const index = annotations.findIndex(item => item.id === operation.data.annotation.id);
            if (index < 0) return [...annotations, operation.data.annotation];
            const next = [...annotations];
            next[index] = operation.data.annotation;
            return next;
        }
        case 'delete-annotation':
            return annotations.filter(item => item.id !== operation.data.id);
        case 'split-stroke':
            return [
                ...annotations.filter(item => item.id !== operation.data.originalId),
                ...operation.data.segments,
            ];
        case 'add-page':
        case 'delete-page':
        case 'move-page':
        case 'rotate-page':
        case 'add-note':
        case 'update-note':
        case 'delete-note':
            return annotations;
        case 'batch':
            return operation.data.operations.reduce(applyOperationToAnnotations, annotations);
    }
}
