import type { SaveAdapter, SaveJob, SaveReason, SaveState } from "./types";
import { Mutex } from "./mutex";

// Deterministic JSON stringify for hashing
function computeHash(payload: any): string {
    return JSON.stringify(payload); // Replace with SHA-256 if payloads get huge
}

export class FileSaveController {
    saveState: SaveState = "idle";
    lastSavedHash?: string;

    private queue: SaveJob | null = null;
    private mutex = new Mutex();
    private autosaveTimer?: number | any; // NodeJS.Timeout or number
    private adapter: SaveAdapter;
    private onStateChange?: (state: SaveState) => void;

    constructor(adapter: SaveAdapter, onStateChange?: (state: SaveState) => void) {
        this.adapter = adapter;
        this.onStateChange = onStateChange;
    }

    private setState(newState: SaveState) {
        this.saveState = newState;
        this.onStateChange?.(newState);
    }

    markDirty(payload: any) {
        // Only mark dirty if hash changed from last save
        const currentHash = computeHash(payload);
        if (currentHash !== this.lastSavedHash) {
            if (this.saveState === "idle") {
                this.setState("dirty");
            }
        }
    }

    async enqueueSave(reason: SaveReason, payload: any) {
        const job: SaveJob = { reason, payload, requestedAt: Date.now() };

        // Hash check short-circuit (Optimization)
        const currentHash = computeHash(payload);
        if (currentHash === this.lastSavedHash && reason === 'autosave') {
            // Redundant autosave, skip
            return;
        }

        // Coalescing Logic: Priority
        // flatten > save-as > manual > autosave
        if (this.queue) {
            // Upgrade priority if needed
            if (this.getPriority(reason) > this.getPriority(this.queue.reason)) {
                this.queue.reason = reason;
            }
            // Always update payload to latest
            this.queue.payload = payload;
            this.queue.requestedAt = Date.now();
        } else {
            this.queue = job;
            this.processQueue();
        }
    }

    private getPriority(reason: SaveReason): number {
        switch (reason) {
            case "flatten": return 4;
            case "save-as": return 3;
            case "manual": return 2;
            case "autosave": return 1;
            default: return 0;
        }
    }

    private async processQueue() {
        if (!this.queue) return;

        // Try to acquire lock. If locked, we wait.
        // NOTE: In this design, processQueue is fired and forgets.
        // Real logic needs to loop if queue is populated again while running.

        await this.mutex.lock();

        try {
            while (this.queue) {
                const job = this.queue;
                this.queue = null; // Dequeue immediately (coalescing happened before this)

                this.setState("saving");

                try {
                    if (job.reason === 'flatten' && this.adapter.flatten) {
                        await this.adapter.flatten(job);
                    } else {
                        await this.adapter.save(job);
                    }

                    this.lastSavedHash = computeHash(job.payload);
                    this.setState("idle");
                } catch (err) {
                    console.error(`[SaveController] Save failed (${job.reason}):`, err);
                    this.setState("error");
                    // Retry logic? For now, simplistic error state.
                }
            }
        } finally {
            this.mutex.unlock();
        }
    }

    enableAutosave(intervalSec: number, getCurrentPayload: () => any) {
        if (this.autosaveTimer) clearInterval(this.autosaveTimer);

        this.autosaveTimer = setInterval(() => {
            if (this.saveState === "dirty") {
                const payload = getCurrentPayload();
                this.enqueueSave("autosave", payload);
            }
        }, intervalSec * 1000);
    }

    disableAutosave() {
        if (this.autosaveTimer) {
            clearInterval(this.autosaveTimer);
            this.autosaveTimer = undefined;
        }
    }
}
