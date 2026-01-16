import axios from 'axios';

const API_Base = '/api'; // Proxy will handle this or absolute URL

// Create axios instance
export const api = axios.create({
    baseURL: API_Base,
    headers: {
        // Mock User for Step 1
        'Authorization': 'Mock test-user-123'
    }
});

export interface CloudFile {
    fileId: string;
    ownerUid: string;
    displayName: string;
    originalFileName: string;
    mimeType: string;
    storageType: string;
    s3Key: string;
    s3Bucket: string;
    createdAt: number;
    updatedAt: number;
}

export const cloudService = {
    // GET /api/files
    async listFiles(): Promise<CloudFile[]> {
        const res = await api.get('/files');
        return Array.isArray(res.data?.files) ? res.data.files : [];
    },

    // POST /api/files/upload
    async uploadFile(file: File): Promise<CloudFile> {
        const formData = new FormData();
        formData.append('file', file);
        const res = await api.post('/files/upload', formData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            }
        });
        return res.data.file;
    },

    // GET /api/files/:fileId/open
    async getDownloadUrl(fileId: string): Promise<string> {
        const res = await api.get(`/files/${fileId}/open`);
        return res.data.downloadUrl;
    },

    // POST /api/files/:fileId/annotations/load
    async loadAnnotations(fileId: string): Promise<any> {
        const res = await api.post(`/files/${fileId}/annotations/load`);
        const { downloadUrl } = res.data;

        // Fetch the actual JSON from S3
        const s3Res = await fetch(downloadUrl);
        return await s3Res.json();
    }
};
