import { auth } from '@/lib/firebase/config';
import type { SaveAdapter, SaveJob } from './types';


// Helper to get client
const getClient = async () => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("Not authenticated");
    return { token };
};

const BACKEND_URL = 'http://localhost:4000/api';

// Deterministic hash again (client side)
async function computeHash(payload: any): Promise<string> {
    const json = JSON.stringify(payload);
    const msgBuffer = new TextEncoder().encode(json);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export class CloudSaveAdapter implements SaveAdapter {
    private fileId: string;
    private folderId: string;
    private displayName: string;

    constructor(fileId: string, folderId: string, displayName?: string) {
        this.fileId = fileId;
        this.folderId = folderId;
        this.displayName = displayName || 'document';
    }

    async save(job: SaveJob) {
        const payload = job.payload;
        const hash = await computeHash(payload);

        console.log(`[CloudSaveAdapter] Saving ${this.fileId}... Reason: ${job.reason}`);

        // Handle Download / Export logic for Cloud
        if (job.reason === 'download-package') {
            // First ensure annotations are saved
            await this.performCloudSave(payload, hash);
            // Then create and download the package
            await this.downloadPackage(payload);
            return;
        }

        if (job.reason === 'flatten') {
            // First ensure annotations are saved
            await this.performCloudSave(payload, hash);
            // Then create and download the flattened PDF
            await this.downloadFlattenedPdf(payload);
            return;
        }

        await this.performCloudSave(payload, hash);
    }

    private async performCloudSave(payload: any, hash: string) {
        const { token } = await getClient();
        const query = this.folderId ? `?folderId=${this.folderId}` : '';

        // 1. Request Save
        const reqRef = await fetch(`${BACKEND_URL}/files/${this.fileId}/annotations/save-request${query}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ payloadHash: hash, folderId: this.folderId })
        });

        if (!reqRef.ok) throw new Error('Save Request failed');
        const reqData = await reqRef.json();

        if (reqData.skip) {
            console.log(`[CloudSaveAdapter] Server says no changes. Skipping.`);
            return;
        }

        const { uploadUrl, annotationsRef } = reqData;

        // 2. Upload to S3
        await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        // 3. Confirm Save
        await fetch(`${BACKEND_URL}/files/${this.fileId}/annotations/confirm${query}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ payloadHash: hash, annotationsRef, folderId: this.folderId })
        });

        console.log(`[CloudSaveAdapter] Save confirmed.`);
    }

    /**
     * Fetch the original PDF bytes from the cloud
     */
    private async fetchOriginalPdf(): Promise<ArrayBuffer> {
        const { token } = await getClient();
        const query = this.folderId ? `?folderId=${this.folderId}` : '';

        // Get the PDF URL from our open endpoint
        const res = await fetch(`${BACKEND_URL}/files/${this.fileId}/open${query}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ folderId: this.folderId })
        });

        if (!res.ok) throw new Error('Failed to get PDF URL');
        const { pdfUrl } = await res.json();

        // Fetch the actual PDF bytes
        const pdfRes = await fetch(pdfUrl);
        if (!pdfRes.ok) throw new Error('Failed to download PDF');
        return await pdfRes.arrayBuffer();
    }

    /**
     * Create and download a flattened PDF (annotations baked in)
     */
    private async downloadFlattenedPdf(payload: any) {
        console.log('[CloudSaveAdapter] Creating flattened PDF...');

        try {
            // 1. Fetch original PDF
            const pdfBytes = await this.fetchOriginalPdf();

            // 2. Flatten using the shared service
            const { flattenLocalPDF } = await import('./flatten-service');
            const flattenedBlob = await flattenLocalPDF(pdfBytes, payload);

            // 3. Download
            const baseName = this.displayName.replace(/\.pdf$/i, '');
            this.downloadBlob(flattenedBlob, `${baseName}-flattened.pdf`);

            console.log('[CloudSaveAdapter] Flattened PDF downloaded.');
        } catch (err) {
            console.error('[CloudSaveAdapter] Flatten failed:', err);
            throw err;
        }
    }

    /**
     * Create and download a package (ZIP with original PDF, annotations JSON, and flattened PDF)
     */
    private async downloadPackage(payload: any) {
        console.log('[CloudSaveAdapter] Creating package...');

        try {
            // Lazy load JSZip
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();

            const baseName = this.displayName.replace(/\.pdf$/i, '');

            // 1. Fetch original PDF
            const pdfBytes = await this.fetchOriginalPdf();
            zip.file(`${baseName}-original.pdf`, pdfBytes);

            // 2. Add annotations JSON
            const annotationsJson = JSON.stringify(payload, null, 2);
            zip.file(`${baseName}-annotations.json`, annotationsJson);

            // 3. Create and add flattened PDF
            const { flattenLocalPDF } = await import('./flatten-service');
            const flattenedBlob = await flattenLocalPDF(pdfBytes, payload);
            zip.file(`${baseName}-flattened.pdf`, flattenedBlob);

            // 4. Generate and download ZIP
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            this.downloadBlob(zipBlob, `${baseName}-package.zip`);

            console.log('[CloudSaveAdapter] Package downloaded.');
        } catch (err) {
            console.error('[CloudSaveAdapter] Package creation failed:', err);
            throw err;
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

    async flatten(job: SaveJob) {
        // Use the save method which handles flatten
        await this.save(job);
    }

    setBaseHash(_hash: string) {
        // Implementation for conflict resolution state tracking
    }

    async forceSave(payload: any) {
        const hash = await computeHash(payload);
        await this.performCloudSave(payload, hash);
    }

    async saveCopy(_payload: any) {
        // Not implemented (needs backend "Save As" / Copy endpoint)
        console.warn("Save Copy not implemented for cloud yet");
        return null;
    }
}
