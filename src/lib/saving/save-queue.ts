
import type { SaveJob, SaveReason } from './types';

export class SaveQueue {
    running: boolean = false;
    pending?: SaveJob;

    enqueue(job: SaveJob): void {
        // Coalescing logic:
        // If a save is requested while another is running:
        // Replace pending job payload (coalesce).
        // Preserve highest priority reason.

        if (!this.pending) {
            this.pending = job;
        } else {
            // Merge logic
            this.pending.payload = job.payload;
            this.pending.requestedAt = job.requestedAt; // Update timestamp to latest
            this.pending.reason = this.getHigherPriority(this.pending.reason, job.reason);
        }
    }

    dequeue(): SaveJob | undefined {
        const job = this.pending;
        this.pending = undefined;
        return job;
    }

    hasPending(): boolean {
        return !!this.pending;
    }

    // Priority order: flatten > save-as > manual > autosave
    private getHigherPriority(r1: SaveReason, r2: SaveReason): SaveReason {
        const priorityScore = (r: SaveReason): number => {
            switch (r) {
                case 'flatten': return 4;
                case 'save-as': return 3;
                case 'manual': return 2;
                case 'autosave': return 1;
                case 'recovery': return 2; // Treat recovery same as manual? Or higher? Assuming similar to manual.
                default: return 0;
            }
        };

        return priorityScore(r1) >= priorityScore(r2) ? r1 : r2;
    }
}
