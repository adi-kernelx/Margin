import type { SaveAdapter, SaveJob } from "./types";

/* Stub Adapters for Step 4 */

export class CloudSaveAdapterStub implements SaveAdapter {
    async save(job: SaveJob) {
        console.log(`[CloudAdapter] Saving (${job.reason})`, job.payload);
        await new Promise(r => setTimeout(r, 800)); // Simulate network latency
        console.log(`[CloudAdapter] Saved.`);
    }
}

export class LocalSaveAdapterStub implements SaveAdapter {
    async save(job: SaveJob) {
        console.log(`[LocalAdapter] Saving (${job.reason})`, job.payload);
        await new Promise(r => setTimeout(r, 100)); // DB is fast
        console.log(`[LocalAdapter] Saved.`);
    }
}
