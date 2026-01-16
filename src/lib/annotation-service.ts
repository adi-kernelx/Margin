
import { auth } from '@/lib/firebase/config';

const BACKEND_URL = 'http://localhost:4000/api/files';

export const annotationService = {
    async loadAnnotations(fileId: string, parentFolderId: string): Promise<any> {
        if (!auth.currentUser) throw new Error("User not authenticated");
        const token = await auth.currentUser.getIdToken();

        // Use the same Open endpoint to get the annotations content
        const query = parentFolderId ? `?folderId=${parentFolderId}` : '';
        const res = await fetch(`${BACKEND_URL}/${fileId}/open${query}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ folderId: parentFolderId })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            throw new Error(err.error || "Failed to load annotations");
        }

        const { annotations } = await res.json();

        // If no annotations, return empty array
        if (!annotations) return [];

        // Return array of objects
        return Array.isArray(annotations) ? annotations : (annotations.objects || []);
    },

    async saveAnnotations(_fileId: string, _parentFolderId: string, _payload: any): Promise<void> {
        console.warn("annotationService.saveAnnotations is deprecated. Use SaveManager + CloudSaveAdapter.");
        // We could implement a fallback here using the Adapter logic if needed,
        // but the app should be using SaveManager.
        throw new Error("Use SaveManager for saving.");
    }
}
