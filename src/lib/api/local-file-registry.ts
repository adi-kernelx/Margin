
import { auth } from '@/lib/firebase/config';

const BACKEND_URL = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';

export interface LocalFileMetadata {
    displayName: string;
    pdfHash: string;
    pageCount: number;
    fileSize: number;
}

export interface RegistrationResult {
    localId: string;
    isNew: boolean;
    file?: any;
}

/**
 * Register a local file with the backend to establish identity
 */
export async function registerLocalFile(meta: LocalFileMetadata): Promise<RegistrationResult> {
    const user = auth.currentUser;
    // If not logged in, we can't register with backend.
    // For now, return a mockup or throw? 
    // Requirement implies authenticated. If offline/anon, maybe just skip?
    if (!user) {
        throw new Error("User must be logged in to register file identity");
    }

    const token = await user.getIdToken();

    const res = await fetch(`${BACKEND_URL}/local-files/register`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(meta)
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to register local file');
    }

    return res.json();
}

/**
 * Compute SHA-256 for a File object (browsers)
 */
export async function computeFileHash(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
