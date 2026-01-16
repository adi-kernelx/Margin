
import type {
    BackendClient,
    AnnotationSaveRequest,
    AnnotationSaveResponse,
    AnnotationConfirmRequest,
    ForceSaveRequest,
    SaveCopyRequest,
    SaveCopyResponse,
    AnnotationLoadResponse
} from './api-types';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

/**
 * Real Backend Client - calls actual server endpoints
 */
export class RealBackendClient implements BackendClient {
    private getAuthToken: () => Promise<string>;

    constructor(getAuthToken: () => Promise<string>) {
        this.getAuthToken = getAuthToken;
    }

    private async fetchWithAuth(endpoint: string, options: RequestInit = {}): Promise<Response> {
        const token = await this.getAuthToken();
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers
        };

        const res = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers
        });

        return res;
    }

    async requestSaveWithConflictCheck(req: AnnotationSaveRequest): Promise<AnnotationSaveResponse> {
        const res = await this.fetchWithAuth('/annotations/save-request', {
            method: 'POST',
            body: JSON.stringify(req)
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Save request failed');
        }

        return res.json();
    }

    async confirmSave(req: AnnotationConfirmRequest): Promise<{ ok: boolean; newHash: string }> {
        const res = await this.fetchWithAuth('/annotations/save-confirm', {
            method: 'POST',
            body: JSON.stringify(req)
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Confirm save failed');
        }

        return res.json();
    }

    async forceSave(req: ForceSaveRequest): Promise<{ ok: boolean; uploadUrl: string }> {
        const res = await this.fetchWithAuth('/annotations/force-save', {
            method: 'POST',
            headers: {
                'X-Force-Overwrite': 'true'
            },
            body: JSON.stringify(req)
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Force save failed');
        }

        return res.json();
    }

    async saveCopy(req: SaveCopyRequest): Promise<SaveCopyResponse> {
        const res = await this.fetchWithAuth('/files/save-copy', {
            method: 'POST',
            body: JSON.stringify(req)
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Save copy failed');
        }

        return res.json();
    }
    /**
     * Request Package Download
     * Calls /files/package which creates a ZIP and returns presigned URL
     */
    async requestPackageDownload(fileId: string, parentFolderId: string): Promise<{ url: string }> {
        console.log('[RealBackendClient] Package download requested for', fileId);

        const res = await this.fetchWithAuth('/files/package', {
            method: 'POST',
            body: JSON.stringify({ fileId, parentFolderId })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Package download failed');
        }

        const data = await res.json();
        return { url: data.url };
    }

    /**
     * Request Flatten PDF
     * Calls /files/flatten which starts an async job, then polls until done
     */
    async requestFlatten(fileId: string, parentFolderId: string, annotations?: any): Promise<{ downloadUrl: string }> {
        console.log('[RealBackendClient] Flatten requested for', fileId);

        // 1. Start flatten job
        const startRes = await this.fetchWithAuth('/files/flatten', {
            method: 'POST',
            body: JSON.stringify({ fileId, parentFolderId, annotations })
        });

        if (!startRes.ok) {
            const err = await startRes.json();
            throw new Error(err.error || 'Failed to start flatten job');
        }

        const { jobId } = await startRes.json();
        console.log('[RealBackendClient] Flatten job started:', jobId);

        // 2. Poll for completion
        const maxWaitMs = 60000; // 60 seconds
        const pollIntervalMs = 2000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

            const statusRes = await this.fetchWithAuth(`/jobs/${jobId}`, {
                method: 'GET'
            });

            if (!statusRes.ok) {
                throw new Error('Failed to check job status');
            }

            const job = await statusRes.json();

            if (job.status === 'DONE') {
                console.log('[RealBackendClient] Flatten job completed');
                return { downloadUrl: job.downloadUrl };
            }

            if (job.status === 'FAILED') {
                throw new Error(job.error || 'Flatten job failed');
            }

            console.log('[RealBackendClient] Flatten job status:', job.status);
        }

        throw new Error('Flatten job timed out');
    }

    async loadAnnotations(fileId: string, parentFolderId: string): Promise<AnnotationLoadResponse> {
        const res = await this.fetchWithAuth('/annotations/load', {
            method: 'POST',
            body: JSON.stringify({ fileId, parentFolderId })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Load annotations failed');
        }

        const data = await res.json();

        return {
            downloadUrl: data.url,
            annotationId: data.annotationId,
            hash: null // Server doesn't return hash on load currently
        };
    }
}
