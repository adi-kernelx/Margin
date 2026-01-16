import type { SaveAdapter, SaveJob } from './types';
import { LocalFileDB } from '../storage/local-file-db';

// Helper for hashing (duplicated from controller, ideally shared utils)
async function hashAnnotationData(data: any): Promise<string> {
    const json = JSON.stringify(data);
    const msgBuffer = new TextEncoder().encode(json);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export class LocalSaveAdapter implements SaveAdapter {
    private localFileId: string;
    private idb: LocalFileDB;

    constructor(
        localFileId: string,
        idb: LocalFileDB
    ) {
        this.localFileId = localFileId;
        this.idb = idb;
    }

    async save(job: SaveJob): Promise<void> {
        console.log('[LocalSaveAdapter] Starting save:', job.reason);
        const state = await this.idb.getLocalFile(this.localFileId);

        // 1. Autosave / Manual (Single Click) -> IDB ONLY
        if (job.reason === 'manual' || job.reason === 'autosave') {
            await this.backupToIndexedDB(job.payload);
            await this.updateMetadata(job.payload); // Update hashes/timestamps
            console.log('[LocalSaveAdapter] Saved to IDB.');
            return;
        }

        // 2. Export / JSON Download
        if (job.reason === 'export') {
            const filename = state?.displayName || 'annotations';
            this.downloadJSON(job.payload, filename);
            return;
        }

        // 3. Save As / Package -> ZIP Package (Original + Flattened + JSON)
        if (job.reason === 'save-as' || job.reason === 'download-package') {
            if (!state?.pdfFileHandle) {
                console.error('[LocalSaveAdapter] Cannot bundle: Original PDF handle missing.');
                return;
            }

            try {
                // Determine Filename
                const baseName = state.displayName.replace(/\.pdf$/i, '');

                // A. Get Original PDF
                const pdfFile = await state.pdfFileHandle.getFile();
                const pdfBytes = await pdfFile.arrayBuffer();

                // B. Flatten PDF
                const { flattenLocalPDF } = await import('./flatten-service'); // Dynamic load
                const flattenedBlob = await flattenLocalPDF(pdfBytes, job.payload);

                // C. JSON
                const jsonString = JSON.stringify(job.payload, null, 2);

                // D. Zip It
                const JSZip = (await import('jszip')).default;
                const zip = new JSZip();
                zip.file(`${baseName}.pdf`, pdfBytes);
                zip.file(`${baseName}-flattened.pdf`, flattenedBlob);
                zip.file(`${baseName}.json`, jsonString);

                const zipBlob = await zip.generateAsync({ type: 'blob' });

                // E. Download Zip
                const zipName = job.reason === 'download-package' ? `${baseName}-package.zip` : `${baseName}.zip`;
                this.downloadBlob(zipBlob, zipName);
                console.log('[LocalSaveAdapter] Package downloaded.');

            } catch (e) {
                console.error('[LocalSaveAdapter] Failed to package:', e);
            }
        }
    }

    async flatten(job: SaveJob): Promise<void> {
        console.log('[LocalSaveAdapter] Flattening...', job.reason);
        const state = await this.idb.getLocalFile(this.localFileId);

        if (!state?.pdfFileHandle) {
            throw new Error('Cannot flatten: Original PDF file handle missing.');
        }

        try {
            // 1. Read Original PDF
            const file = await state.pdfFileHandle.getFile();
            const pdfBytes = await file.arrayBuffer();

            // 2. Import service
            const { flattenLocalPDF } = await import('./flatten-service');

            // 3. Generate Flattened Blob
            const blob = await flattenLocalPDF(pdfBytes, job.payload);

            // 4. Download
            const name = state.displayName.replace(/\.pdf$/i, '');
            this.downloadBlob(blob, `${name}-flattened.pdf`);

            // 5. Update Metadata
            await this.idb.updateLocalFile(this.localFileId, {
                lastFlattenSavedAt: Date.now()
            });

        } catch (e) {
            console.error('[LocalSaveAdapter] Flatten failed:', e);
        }
    }

    private downloadBlob(blob: Blob, filename: string) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // --- Helpers ---


    private async backupToIndexedDB(payload: any) {
        console.log('[LocalSaveAdapter] Backing up to IndexedDB');
        await this.idb.saveBackup({
            localFileId: this.localFileId,
            annotationsJSON: payload,
            updatedAt: Date.now()
        });
    }

    private async updateMetadata(payload: any) {
        const hash = await hashAnnotationData(payload);
        await this.idb.updateLocalFile(this.localFileId, {
            lastAnnotationsHash: hash,
            lastSavedAt: Date.now()
        });
    }

    private downloadJSON(payload: any, filename: string) {
        console.log('[LocalSaveAdapter] Downloading JSON fallback');
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}
