import { auth } from '@/lib/firebase/config';

const BACKEND_URL = 'http://localhost:4000'; // Or env var

export interface SharePermission {
    uid: string;
    email: string; // or 'Unknown'
    displayName: string;
    role: 'view' | 'edit';
    grantedAt: any;
}

export interface UserResult {
    uid: string;
    email?: string;
    displayName?: string;
    photoURL?: string;
}

export interface ShareLink {
    shareId: string;
    role: 'view' | 'edit';
    disabled: boolean;
    usageCount: number;
    createdAt: string | null;
    expiresAt: string | null;
    lastUsedAt: string | null;
    requireAuth: boolean;
    token?: string;
    url?: string;
}


export const shareService = {
    async listUsers(query: string): Promise<UserResult[]> {
        if (!auth.currentUser) throw new Error("User not authenticated");
        const token = await auth.currentUser.getIdToken();

        const res = await fetch(`${BACKEND_URL}/api/users/list?q=${encodeURIComponent(query)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Failed to search users");
        const { users } = await res.json();
        return users;
    },

    async listPermissions(scopeId: string, scopeType: 'file' | 'folder'): Promise<SharePermission[]> {
        if (!auth.currentUser) throw new Error("User not authenticated");
        const token = await auth.currentUser.getIdToken();

        const res = await fetch(`${BACKEND_URL}/api/share/permissions?scopeId=${scopeId}&scopeType=${scopeType}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            if (res.status === 403) return []; // If not owner, maybe just return empty or throw? 
            // The UI will handle it (if owner check fails).
            const err = await res.json();
            throw new Error(err.error || "Failed to list permissions");
        }
        const { permissions } = await res.json();
        return permissions;
    },

    async shareUser(targetUid: string, scopeId: string, scopeType: 'file' | 'folder', role: 'view' | 'edit') {
        if (!auth.currentUser) throw new Error("User not authenticated");
        const token = await auth.currentUser.getIdToken();

        const res = await fetch(`${BACKEND_URL}/api/share/user`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ targetUid, scopeId, scopeType, role })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to share");
        }
        return res.json();
    },

    async revokeUser(targetUid: string, scopeId: string, scopeType: 'file' | 'folder') {
        if (!auth.currentUser) throw new Error("User not authenticated");
        const token = await auth.currentUser.getIdToken();

        const res = await fetch(`${BACKEND_URL}/api/share/revoke`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ targetUid, scopeId, scopeType })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to revoke path");
        }
        return res.json();
    },

    async updateUserRole(targetUid: string, scopeId: string, scopeType: 'file' | 'folder', role: 'view' | 'edit') {
        if (!auth.currentUser) throw new Error("User not authenticated");
        const token = await auth.currentUser.getIdToken();

        const res = await fetch(`${BACKEND_URL}/api/share/user`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ targetUid, scopeId, scopeType, role })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to update role");
        }
        return res.json();
    },

    async listSharedWithMe() {
        if (!auth.currentUser) throw new Error("User not authenticated");
        const token = await auth.currentUser.getIdToken();

        const res = await fetch(`${BACKEND_URL}/api/share/with-me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Failed to list shared with me");
        const { items } = await res.json();
        return items;
    },

    async listSharedByMe() {
        if (!auth.currentUser) throw new Error("User not authenticated");
        const token = await auth.currentUser.getIdToken();

        const res = await fetch(`${BACKEND_URL}/api/share/by-me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Failed to list shared by me");
        const { items } = await res.json();
        return items;
    },

    async createLink(scopeId: string, scopeType: 'file' | 'folder', role: 'view' | 'edit' = 'view', requireAuth: boolean = false, expiresAt?: number) {
        if (!auth.currentUser) throw new Error("User not authenticated");
        const token = await auth.currentUser.getIdToken();

        const res = await fetch(`${BACKEND_URL}/api/share/link/create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ scopeId, scopeType, role, requireAuth, expiresAt })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to create link");
        }
        return res.json();
    },

    async listLinks(scopeId: string, scopeType: 'file' | 'folder'): Promise<ShareLink[]> {
        if (!auth.currentUser) throw new Error("User not authenticated");
        const token = await auth.currentUser.getIdToken();

        const res = await fetch(`${BACKEND_URL}/api/share/link/list?scopeId=${scopeId}&scopeType=${scopeType}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to list links");
        }
        const { links } = await res.json();
        return links;
    },

    async revokeLink(shareId: string) {
        if (!auth.currentUser) throw new Error("User not authenticated");
        const token = await auth.currentUser.getIdToken();

        const res = await fetch(`${BACKEND_URL}/api/share/link/revoke`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ shareId })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to revoke link");
        }
        return res.json();
    },

    async resolveLink(shareId: string, tokenStr: string) {
        // Optional Auth
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (auth.currentUser) {
            const token = await auth.currentUser.getIdToken();
            headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(`${BACKEND_URL}/api/share/link/resolve?shareId=${shareId}&token=${tokenStr}`, {
            method: 'GET',
            headers
        });

        if (!res.ok) {
            const err = await res.json();
            if (res.status === 401) throw new Error("AUTH_REQUIRED");
            throw new Error(err.error || "Failed to resolve link");
        }
        return res.json();
    },

    async resolveLinkChildren(shareId: string, token: string) {
        const res = await fetch(`${BACKEND_URL}/api/share/link/children?shareId=${shareId}&token=${token}`);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to list children");
        }
        return res.json();
    },

    async resolveNestedFile(shareId: string, token: string, fileId: string) {
        const res = await fetch(`${BACKEND_URL}/api/share/link/access-file?shareId=${shareId}&token=${token}&fileId=${fileId}`);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to access file");
        }
        return res.json();
    },

    async downloadFolderZip(shareId: string, token: string, subFolderId?: string) {
        const url = `${BACKEND_URL}/api/share/link/zip?shareId=${shareId}&token=${token}${subFolderId ? `&subFolderId=${subFolderId}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to download zip");
        }
        return res.blob();
    }
};
