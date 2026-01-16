import type { Operation } from './models';
import { annotationStorage } from './storage';

class OperationManager {
    // Global History: Single source of truth. Contains ALL operations.
    // Ordered by timestamp (creation time).
    // NEVER delete entries. Only toggle applied/undone flags.
    private globalLog: Operation[] = [];

    // Per-PDF stacks (Indexes into globalLog)
    private undoStacks: Map<string, string[]> = new Map(); // Op IDs
    private redoStacks: Map<string, string[]> = new Map(); // Op IDs

    private listeners: Map<string, Set<() => void>> = new Map();

    subscribe(docId: string, callback: () => void) {
        if (!this.listeners.has(docId)) {
            this.listeners.set(docId, new Set());
        }
        this.listeners.get(docId)!.add(callback);
        return () => {
            this.listeners.get(docId)?.delete(callback);
        };
    }

    private notify(docId: string) {
        this.listeners.get(docId)?.forEach(cb => cb());
    }

    async loadOperations(docId: string) {
        // Prevent duplicate loads
        // We assume globalLog persists in memory during session.
        // If we reload a file, we might re-fetch ops. 
        // Sync logic: fetch ops, if not in globalLog, add them.
        const ops = await annotationStorage.getOperationsByFile(docId, 100);

        ops.forEach(op => {
            op.docId = docId;
            op.applied = true; // Loaded ops are applied history

            // Check if already in log
            const existing = this.globalLog.find(g => g.id === op.id);
            if (!existing) {
                this.globalLog.push(op);
                // Reconstruct undo stack (assumed all applied)
                this.pushToUndoStack(docId, op.id);
            }
        });

        // Ensure global log is strictly sorted by timestamp
        this.globalLog.sort((a, b) => a.timestamp - b.timestamp);
    }

    async addOperation(op: Operation) {
        op.applied = true;
        this.globalLog.push(op);

        // Push to local undo stack
        this.pushToUndoStack(op.docId, op.id);

        // Clear local redo stack ONLY
        this.redoStacks.set(op.docId, []);

        // Note: We DO NOT truncate globalLog.
        // Orphaned undone ops in globalLog will be handled by validity checks in Global Redo.

        await annotationStorage.saveOperation(op, op.docId);
        // this.notify(op.docId); // Optional if UI updates optimistically
    }

    // ==========================================
    // GLOBAL UNDO / REDO
    // ==========================================

    async undoGlobal() {
        // 1. Find last APPLIED entry in globalLog
        // Iterate backwards
        let entry: Operation | undefined;
        for (let i = this.globalLog.length - 1; i >= 0; i--) {
            if (this.globalLog[i].applied) {
                entry = this.globalLog[i];
                break;
            }
        }

        if (!entry) return; // Nothing to undo

        // 2. Undo the operation
        await this.undoImplementation(entry);
        entry.applied = false;

        // 3. Update per-PDF stacks
        const uStack = this.undoStacks.get(entry.docId);
        if (uStack) {
            // It should be at the top if chronological sync matches,
            // but with local undo/redo mixing, it might be deep?
            // "Undo the most recently performed operation anywhere" implies strict time order.
            // If we locally undid a newer op, `entry` will be an older op.
            // Is it valid to undo an older op while newer ops are applied on the SAME doc?
            // Local undo stack enforces LIFO.
            // But Global Undo essentially ignores per-doc LIFO?
            // No, user says: "undoStack[pdfId].pop()". This implies `entry` MUST be at top.
            // If `entry` is NOT at top of `undoStack` (because we have newer applied ops on this doc),
            // then `globalLog` ordering vs `undoStack` ordering is mismatched.
            // This happens if we insert ops out of order? No, ops are strictly chronological.
            // If `entry` is the last applied global op, it MUST be the last applied op for its doc too.
            // Proof: If there was a newer op on this doc, it would be later in globalLog and applied.
            // So `entry` would be that newer op.
            // Conclusion: `entry` is guaranteed to be at top of `undoStack[entry.docId]`.
            uStack.pop();
        }

        this.pushToRedoStack(entry.docId, entry.id);

        this.notify(entry.docId);
    }

    async redoGlobal() {
        // 1. Find last UNDONE entry in globalLog 
        // (Iterate backwards: "Redo the last globally undone operation")
        // User logic: "findLastUndone(globalLog)".
        // Wait, if 1(U), 2(U). Backwards finds 2. Redo 2. Log: 1(U), 2(A). Correct.
        let entry: Operation | undefined;
        for (let i = this.globalLog.length - 1; i >= 0; i--) {
            // We search for undone ops.
            // IMPORTANT: We must ignore "dead" ops (orphaned by new edits).
            // An op is dead if it is NOT in the local redo stack.
            const op = this.globalLog[i];
            if (!op.applied) {
                const rStack = this.redoStacks.get(op.docId);
                // Check if opId is in redoStack. 
                // Since redoStack is LIFO, checking existence is enough for "liveness".
                // But specifically for Global Redo (Ctrl+Y), we usually redo the *top* of the stack?
                // If `op` is 2(U) and 3(U) is newer on same doc.
                // Log: ... 2(U) ... 3(U) ...
                // `findLastUndone` finds 3.
                // `redoStack` has [2, 3] (since 3 was undone last).
                // So 3 is valid.
                if (rStack && rStack.includes(op.id)) {
                    entry = op;
                    break;
                }
            }
        }

        if (!entry) return;

        // 2. Redo the operation
        await this.redoImplementation(entry);
        entry.applied = true;

        // 3. Update stacks
        const rStack = this.redoStacks.get(entry.docId);
        if (rStack) {
            // Should be at top/end if strictly synchronized?
            // If we found 3, and stack is [2, 3], popping gives 3. Correct.
            // What if we found 2? (Meaning 3 was applied).
            // Stack [2]. Pop gives 2. Correct.
            // What if we found 2, but 3(U) exists in log but was dead?
            // Log: 2(U), 3(U)-Dead.
            // Backwards finds 3. 3 not in rStack (cleared). Skip.
            // Finds 2. 2 in rStack. Valid.
            // Popping rStack gives 2? Yes, [2].
            const popped = rStack.pop();
            if (popped !== entry.id) {
                // Should not happen if logic holds.
                // If it does, strictly remove specific ID?
                // rStack represents valid redoable history.
                // If we found `entry` in rStack, we should remove it.
                // If it wasn't at tip, we have a problem (redoing out of order).
                // But logical scan order ensures we pick the "latest" valid.
                // So it should be at tip.
                if (popped !== undefined && popped !== entry.id) {
                    console.warn("Global redo mismatch with local stack", popped, entry.id);
                    // Put popped back? Or fix?
                    // Force fix: remove entry.id from array
                    rStack.push(popped); // Restore tip
                    const idx = rStack.indexOf(entry.id);
                    if (idx !== -1) rStack.splice(idx, 1);
                }
            }
        }

        this.pushToUndoStack(entry.docId, entry.id);

        this.notify(entry.docId);
    }

    // ==========================================
    // LOCAL UNDO / REDO
    // ==========================================

    async undoLocal(docId: string) {
        const uStack = this.undoStacks.get(docId);
        if (!uStack || uStack.length === 0) return;

        const opId = uStack.pop()!;
        const entry = this.globalLog.find(o => o.id === opId);

        if (!entry || !entry.applied) {
            console.error("Local undo state mismatch", opId);
            return;
        }

        // 1. Undo
        await this.undoImplementation(entry);

        // 2. Mark global entry UNDONE
        entry.applied = false;

        // 3. Push to local REDO
        this.pushToRedoStack(docId, opId);

        this.notify(docId);
    }

    async redoLocal(docId: string) {
        const rStack = this.redoStacks.get(docId);
        if (!rStack || rStack.length === 0) return;

        const opId = rStack.pop()!;
        const entry = this.globalLog.find(o => o.id === opId);

        if (!entry || entry.applied) {
            console.error("Local redo state mismatch", opId);
            return;
        }

        // 1. Redo
        await this.redoImplementation(entry);

        // 2. Mark global entry APPLIED
        entry.applied = true;

        // 3. Push to local UNDO
        this.pushToUndoStack(docId, opId);

        this.notify(docId);
    }

    // ==========================================
    // HELPERS
    // ==========================================

    private pushToUndoStack(docId: string, opId: string) {
        if (!this.undoStacks.has(docId)) this.undoStacks.set(docId, []);
        this.undoStacks.get(docId)!.push(opId);
    }

    private pushToRedoStack(docId: string, opId: string) {
        if (!this.redoStacks.has(docId)) this.redoStacks.set(docId, []);
        this.redoStacks.get(docId)!.push(opId);
    }

    private async undoImplementation(op: Operation) {
        // Apply inverse
        if (op.inverse) {
            await this.applyInternal(op.inverse);
        } else {
            console.warn("Operation missing inverse", op);
        }
    }

    private async redoImplementation(op: Operation) {
        await this.applyInternal(op);
    }

    private async applyInternal(op: Operation) {
        switch (op.type) {
            case 'add-annotation':
                await annotationStorage.saveAnnotation(op.data.annotation, op.docId);
                break;
            case 'update-annotation':
                await annotationStorage.saveAnnotation(op.data.annotation, op.docId);
                break;
            case 'delete-annotation':
                await annotationStorage.deleteAnnotation(op.data.id);
                break;
            case 'batch':
                for (const subOp of op.data.operations) {
                    await this.applyInternal({ ...subOp, docId: op.docId } as Operation);
                }
                break;
        }
    }
    clearHistory(docId: string) {
        this.undoStacks.delete(docId);
        this.redoStacks.delete(docId);
        // Filter out operations for this doc from global log?
        // If we want to strictly drop them:
        this.globalLog = this.globalLog.filter(op => op.docId !== docId);
        this.notify(docId);
    }
}

export const operationManager = new OperationManager();
