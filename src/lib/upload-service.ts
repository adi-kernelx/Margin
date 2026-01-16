
import { auth } from '@/lib/firebase/config';

const BACKEND_URL = 'http://localhost:4000'; // Or env var

export const uploadService = {
    async uploadFile(file: File, parentFolderId: string) {
        if (!auth.currentUser) throw new Error("User not authenticated");

        const token = await auth.currentUser.getIdToken();
        const formData = new FormData();
        formData.append('file', file);
        if (parentFolderId && parentFolderId !== 'root') {
            // Backend expects 'parentFolderId'
            formData.append('parentFolderId', parentFolderId);
        }

        // Use standard multipart upload
        const res = await fetch(`${BACKEND_URL}/api/files/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Upload failed");
        }

        const { file: fileDoc } = await res.json();
        return { fileId: fileDoc.id };
    },

    async getDownloadUrl(fileId: string, parentFolderId: string, ownerUid?: string) {
        if (!auth.currentUser) throw new Error("User not authenticated");
        const token = await auth.currentUser.getIdToken();
        const currentUid = auth.currentUser.uid;

        // If ownerUid is me, don't send it (optional optimization, but good for cleanliness)
        const ownerQuery = (ownerUid && ownerUid !== currentUid) ? `&ownerId=${ownerUid}` : '';
        const query = parentFolderId ? `?folderId=${parentFolderId}${ownerQuery}` : `?${ownerQuery.slice(1)}`;

        const res = await fetch(`${BACKEND_URL}/api/files/${fileId}/open${query}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to get download URL");
        }

        const { downloadUrl } = await res.json();
        return downloadUrl;
    },

    async getFileViewUrl(fileId: string, parentFolderId: string, ownerUid?: string) {
        if (!auth.currentUser) throw new Error("User not authenticated");
        const token = await auth.currentUser.getIdToken();
        const currentUid = auth.currentUser.uid;

        // Use the unified Open API which returns { pdfUrl, annotations }
        // Send folderId in both query (for compatibility) and body (standard POST)
        const ownerQuery = (ownerUid && ownerUid !== currentUid) ? `&ownerId=${ownerUid}` : '';
        const query = parentFolderId ? `?folderId=${parentFolderId}${ownerQuery}` : `?${ownerQuery.slice(1)}`;

        const res = await fetch(`${BACKEND_URL}/api/files/${fileId}/open${query}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                folderId: parentFolderId,
                ownerId: (ownerUid && ownerUid !== currentUid) ? ownerUid : undefined
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            console.error('[uploadService] getFileViewUrl error:', res.status, err);
            throw new Error(err.error || err.details || "Failed to load file");
        }

        const { pdfUrl } = await res.json();
        return pdfUrl;
    },

    async downloadFolderZip(folderId: string, folderName: string, ownerUid?: string) {
        if (!auth.currentUser) throw new Error("User not authenticated");
        const token = await auth.currentUser.getIdToken();
        const currentUid = auth.currentUser.uid;

        const ownerQuery = (ownerUid && ownerUid !== currentUid) ? `&ownerId=${ownerUid}` : '';
        const url = `${BACKEND_URL}/api/files/download/zip?folderId=${folderId}${ownerQuery}`;

        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || "Download failed");
        }

        // Trigger download
        const blob = await res.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = downloadUrl;

        // Use provided name as default, fallback to header if available and different?
        // Actually, Trust the frontend name is often better/easier if header parsing fails.
        // But backend might sanitise.
        // Let's rely on header if present, else fallback to provided name.
        let fileName = `${folderName}.zip`;

        const contentDisposition = res.headers.get('Content-Disposition');
        if (contentDisposition) {
            // Robust parsing
            const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
            const matches = filenameRegex.exec(contentDisposition);
            if (matches != null && matches[1]) {
                fileName = matches[1].replace(/['"]/g, '');
            }
        }

        a.download = fileName;
        document.body.appendChild(a);
        a.click();

        window.URL.revokeObjectURL(downloadUrl);
        document.body.removeChild(a);
    }
}
