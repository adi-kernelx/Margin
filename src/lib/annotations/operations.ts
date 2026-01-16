import type { Annotation, Operation } from './models';
import { annotationStorage } from './storage';

// Command pattern for undo/redo
export class OperationLog {
    private undoStack: Operation[] = [];
    private redoStack: Operation[] = [];
    private maxHistory = 100;
    private fileId: string;

    constructor(fileId: string) {
        this.fileId = fileId;
    }

    async init() {
        // Load operations from storage
        const ops = await annotationStorage.getOperationsByFile(this.fileId, this.maxHistory);
        this.undoStack = ops.reverse();
    }

    async execute(op: Operation): Promise<void> {
        // Apply the operation
        await this.applyOperation(op);

        // Add to undo stack
        this.undoStack.push(op);
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }

        // Clear redo stack on new action
        this.redoStack = [];

        // Persist to storage
        await annotationStorage.saveOperation(op, this.fileId);
    }

    async undo(): Promise<Operation | null> {
        const op = this.undoStack.pop();
        if (!op || !op.inverse) return null;

        await this.applyOperation(op.inverse);
        this.redoStack.push(op);

        return op.inverse;
    }

    async redo(): Promise<Operation | null> {
        const op = this.redoStack.pop();
        if (!op) return null;

        await this.applyOperation(op);
        this.undoStack.push(op);

        return op;
    }

    canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    private async applyOperation(op: Operation): Promise<void> {
        switch (op.type) {
            case 'add-annotation':
                await annotationStorage.saveAnnotation(op.data.annotation, this.fileId);
                break;

            case 'update-annotation':
                await annotationStorage.saveAnnotation(op.data.annotation, this.fileId);
                break;

            case 'delete-annotation':
                await annotationStorage.deleteAnnotation(op.data.id);
                break;

            case 'split-stroke':
                // Delete original, add new segments
                await annotationStorage.deleteAnnotation(op.data.originalId);
                for (const segment of op.data.segments) {
                    await annotationStorage.saveAnnotation(segment, this.fileId);
                }
                break;

            case 'batch':
                // Apply multiple operations
                for (const subOp of op.data.operations) {
                    await this.applyOperation(subOp);
                }
                break;
        }
    }
}

// Helper functions to create operations
export function createAddOperation(annotation: Annotation, docId: string): Operation {
    return {
        id: `op-${Date.now()}-${Math.random()}`,
        docId,
        type: 'add-annotation',
        timestamp: Date.now(),
        data: { annotation },
        inverse: {
            id: `op-${Date.now()}-${Math.random()}`,
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
        id: `op-${Date.now()}-${Math.random()}`,
        docId,
        type: 'update-annotation',
        timestamp: Date.now(),
        data: { annotation },
        inverse: {
            id: `op-${Date.now()}-${Math.random()}`,
            docId,
            type: 'update-annotation',
            timestamp: Date.now(),
            data: { annotation: previousState },
        },
    };
}

export function createDeleteOperation(annotation: Annotation, docId: string): Operation {
    return {
        id: `op-${Date.now()}-${Math.random()}`,
        docId,
        type: 'delete-annotation',
        timestamp: Date.now(),
        data: { id: annotation.id },
        inverse: {
            id: `op-${Date.now()}-${Math.random()}`,
            docId,
            type: 'add-annotation',
            timestamp: Date.now(),
            data: { annotation },
        },
    };
}

export function createBatchOperation(operations: Operation[], docId: string): Operation {
    return {
        id: `op-${Date.now()}-${Math.random()}`,
        docId,
        type: 'batch',
        timestamp: Date.now(),
        data: { operations },
        inverse: {
            id: `op-${Date.now()}-${Math.random()}`,
            docId,
            type: 'batch',
            timestamp: Date.now(),
            data: {
                operations: operations
                    .map(op => op.inverse)
                    .filter(Boolean)
                    .reverse(),
            },
        },
    };
}
