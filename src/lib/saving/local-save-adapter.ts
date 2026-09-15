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
    private pristinePdfBytes: ArrayBuffer | null = null; // Cache of original PDF before any flatten

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

                // A. Get Original PDF (use pristine if available)
                const pdfBytes = job.pdfBytes
                    ? job.pdfBytes.slice().buffer
                    : await this.getPristinePdfBytes(state.pdfFileHandle);

                // The editable PDF contains native annotations for other PDF
                // viewers plus Margin's JSON attachment for lossless reopening.
                const { PDFDocument } = await import('pdf-lib');
                const { embedAnnotations } = await import('../pdf-data-manager');
                const editablePdf = await PDFDocument.load(pdfBytes);
                await embedAnnotations(editablePdf, job.payload.objects);
                const editablePdfBytes = await editablePdf.save();

                // B. Flatten PDF
                const { flattenLocalPDF } = await import('./flatten-service'); // Dynamic load
                const flattenedBlob = await flattenLocalPDF(pdfBytes, job.payload);

                // C. JSON
                const jsonString = JSON.stringify(job.payload, null, 2);

                // D. Zip It
                const JSZip = (await import('jszip')).default;
                const zip = new JSZip();
                zip.file(`${baseName}.pdf`, editablePdfBytes);
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
            // 1. Get the PRISTINE (pre-flatten) PDF bytes — never the already-flattened file
            const pdfBytes = job.pdfBytes
                ? job.pdfBytes.slice().buffer
                : await this.getPristinePdfBytes(state.pdfFileHandle);

            // 2. Import service
            const { flattenLocalPDF } = await import('./flatten-service');

            // 3. Generate Flattened Blob from pristine base + current annotations
            const blob = await flattenLocalPDF(pdfBytes, job.payload);

            // 4. Write back to the ORIGINAL file location (overwrite in-place)
            try {
                // Request write permission on the original handle
                const permission = await (state.pdfFileHandle as any).requestPermission({ mode: 'readwrite' });
                if (permission !== 'granted') {
                    throw new Error('Write permission denied');
                }

                // Write the flattened PDF directly to the original file
                const writable = await state.pdfFileHandle.createWritable();
                await writable.write(blob);
                await writable.close();

                console.log('[LocalSaveAdapter] Flattened PDF saved back to original location:', state.displayName);

            } catch (writeErr) {
                // Fallback: if File System Access write fails (e.g. permission denied, unsupported),
                // fall back to a regular download
                console.warn('[LocalSaveAdapter] Could not write back to original file, falling back to download:', writeErr);
                const name = state.displayName.replace(/\.pdf$/i, '');
                this.downloadBlob(blob, `${name}-flattened.pdf`);
            }

            // 5. Update Metadata
            await this.idb.updateLocalFile(this.localFileId, {
                lastFlattenSavedAt: Date.now()
            });

        } catch (e) {
            console.error('[LocalSaveAdapter] Flatten failed:', e);
        }
    }

    /**
     * Get the pristine (original, pre-flatten) PDF bytes.
     * On first call, reads from the file handle and caches the bytes.
     * On subsequent calls, returns the cached copy so we never read
     * an already-flattened file from disk.
     */
    private async getPristinePdfBytes(handle: FileSystemFileHandle): Promise<ArrayBuffer> {
        if (!this.pristinePdfBytes) {
            const file = await handle.getFile();
            this.pristinePdfBytes = await file.arrayBuffer();
            console.log('[LocalSaveAdapter] Cached pristine PDF bytes:', this.pristinePdfBytes.byteLength, 'bytes');
        }
        return this.pristinePdfBytes;
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
