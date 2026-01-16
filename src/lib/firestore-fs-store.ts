import { create } from 'zustand';
import { type FirestoreFolder, type FirestoreFileMetadata } from '@/types/firestore';
import { auth } from './firebase/config';

// Base URL for Backend
const API_URL = 'http://localhost:4000/api/files';

async function getAuthHeaders() {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("Not authenticated");
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}

interface FileSystemState {
    folders: Record<string, FirestoreFolder>; // Cache by ID
    files: Record<string, FirestoreFileMetadata[]>; // Cache files by FolderID
    currentFolderId: string | null;
    loading: boolean;
    error: string | null;

    initialize: () => Promise<void>;
    loadFolderContents: (folderId: string) => Promise<void>;

    // Actions using Backend API
    createFolder: (name: string, parentId: string | null) => Promise<void>;
    renameFolder: (folderId: string, newName: string) => Promise<void>;
    deleteFolder: (folderId: string, parentFolderId?: string) => Promise<void>;

    renameFile: (folderId: string, fileId: string, newName: string) => Promise<void>;
    deleteFile: (folderId: string, fileId: string) => Promise<void>;

    // Actions that might trigger backend upload or placeholder
    createFileEntry: (name: string, parentFolderId: string) => Promise<void>;

    setCurrentFolderId: (id: string | null) => void;
}

export const useFileSystemStore = create<FileSystemState>((set, get) => ({
    folders: {},
    files: {},
    currentFolderId: null, // 'root' or UUID
    loading: false,
    error: null,

    initialize: async () => {
        // Ensure root exists in state so UI renders
        const rootFolder: FirestoreFolder = {
            id: 'root',
            name: 'My Files',
            parentFolderId: null,
            createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
            updatedAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
            ownerUid: 'current-user'
        };

        const sharedWithMeFolder: FirestoreFolder = {
            id: 'shared-with-me',
            name: 'Shared with you',
            parentFolderId: null,
            createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
            updatedAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
            ownerUid: 'system'
        };

        const sharedByMeFolder: FirestoreFolder = {
            id: 'shared-by-me',
            name: 'Shared by you',
            parentFolderId: null,
            createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
            updatedAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
            ownerUid: 'system'
        };

        set(state => ({
            folders: {
                ...state.folders,
                'root': rootFolder,
                'shared-with-me': sharedWithMeFolder,
                'shared-by-me': sharedByMeFolder
            },
            currentFolderId: state.currentFolderId || 'root'
        }));

        // Now load contents
        await get().loadFolderContents('root');
    },

    loadFolderContents: async (folderId: string) => {
        set({ loading: true, error: null });
        try {
            const headers = await getAuthHeaders();
            let newFolders: Record<string, FirestoreFolder> = {};
            let folderFiles: FirestoreFileMetadata[] = [];

            if (folderId === 'shared-with-me') {
                // Virtual folder
                const { shareService } = await import('@/lib/share-service');
                const items = await shareService.listSharedWithMe();
                items.forEach((item: any) => {
                    const isFolder = item.type === 'folder' || item.refType === 'folder';
                    // For UI display, use 'shared-with-me' as parent so items appear in the correct section
                    // Store original folder info in separate field for file lookups
                    const common = {
                        id: item.id,
                        name: item.name,
                        // Use 'shared-with-me' as parentFolderId for UI display
                        parentFolderId: 'shared-with-me',
                        // Store original parent for file lookups (used by PDFViewer/collab)
                        originalParentFolderId: item.parentFolderId || item.parentId || 'root',
                        ownerUid: item.ownerUid || item.sharedBy,
                        sharedRole: item.sharedRole || item.role,
                        createdAt: item.createdAt,
                        updatedAt: item.updatedAt
                    };

                    if (isFolder) {
                        newFolders[item.id] = { ...common } as FirestoreFolder;
                    } else {
                        folderFiles.push({
                            ...common,
                            mimeType: 'application/pdf',
                            status: 'synced',
                            storageType: 'cloud',
                            sizeBytes: item.sizeBytes
                        } as any);
                    }
                });

            } else if (folderId === 'shared-by-me') {
                // Virtual folder
                const { shareService } = await import('@/lib/share-service');
                const items = await shareService.listSharedByMe();
                items.forEach((item: any) => {
                    const isFolder = item.type === 'folder' || item.refType === 'folder';
                    const common = {
                        id: item.id,
                        name: item.name,
                        parentFolderId: folderId,
                        ownerUid: item.ownerUid,
                        createdAt: item.createdAt,
                        updatedAt: item.updatedAt
                    };

                    if (isFolder) {
                        newFolders[item.id] = { ...common } as FirestoreFolder;
                    } else {
                        folderFiles.push({
                            ...common,
                            mimeType: 'application/pdf',
                            status: 'synced',
                            storageType: 'cloud',
                            sizeBytes: item.sizeBytes
                        } as any);
                    }
                });

            } else {
                // Regular folder (Root or Child)
                // If it's a child folder, check if it's shared to pass ownerUid?
                // The backend now accepts ?ownerId=...
                // We check if the cached folder has an ownerUid diff from current user?
                // But we don't have current user ID easily here without auth.currentUser
                // We can assume if ownerUid is in folder metadata, we use it.

                const cachedFolder = get().folders[folderId];
                const ownerQuery = cachedFolder?.ownerUid ? `?ownerId=${cachedFolder.ownerUid}` : '';

                const res = await fetch(`${API_URL}/folders/${folderId}/children${ownerQuery}`, { headers });

                if (!res.ok) throw new Error(`Failed to load folder: ${res.statusText}`);

                const data = await res.json();

                (data.items || []).forEach((item: any) => {
                    if (item.type === 'folder') {
                        newFolders[item.id] = {
                            id: item.id,
                            name: item.name,
                            parentFolderId: item.parentId || folderId,
                            createdAt: item.createdAt,
                            updatedAt: item.updatedAt,
                            ownerUid: item.createdBy || item.ownerUid
                        };
                    } else if (item.type === 'file') {
                        folderFiles.push({
                            id: item.id,
                            name: item.name,
                            parentFolderId: item.parentId || folderId,
                            ownerUid: item.createdBy || item.ownerUid,
                            createdAt: item.createdAt,
                            updatedAt: item.updatedAt,
                            mimeType: item.mimeType || 'application/pdf',
                            status: item.status || 'synced',
                            storageType: item.storageType || 'cloud',
                            sizeBytes: item.sizeBytes,
                        } as any);
                    }
                });
            }

            set(state => ({
                folders: { ...state.folders, ...newFolders },
                files: { ...state.files, [folderId]: folderFiles },
                loading: false
            }));

        } catch (err: any) {
            console.error("Load contents failed:", err);
            set({ error: err.message, loading: false });
        }
    },

    createFolder: async (name: string, parentId: string | null) => {
        set({ loading: true });
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`${API_URL}/folders`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ name, parentFolderId: parentId })
            });

            if (!res.ok) throw new Error('Create folder failed');
            const { folder } = await res.json();

            // Optimistic / Cache update
            set(state => ({
                folders: { ...state.folders, [folder.id]: folder }
            }));

            // Reload parent to be safe?
            await get().loadFolderContents(parentId || 'root');

        } catch (err: any) {
            set({ error: err.message });
        } finally {
            set({ loading: false });
        }
    },

    renameFolder: async (folderId: string, newName: string) => {
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`${API_URL}/folders/${folderId}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ name: newName })
            });
            if (!res.ok) throw new Error('Rename failed');

            set(state => ({
                folders: {
                    ...state.folders,
                    [folderId]: { ...state.folders[folderId], name: newName }
                }
            }));
        } catch (err: any) {
            set({ error: err.message });
        }
    },

    deleteFolder: async (folderId: string, parentFolderId?: string) => {
        if (folderId === 'root') return;
        set({ loading: true });
        try {
            const headers = await getAuthHeaders();
            const queryParams = parentFolderId && parentFolderId !== 'root'
                ? `?parentFolderId=${parentFolderId}`
                : '';
            const res = await fetch(`${API_URL}/folders/${folderId}${queryParams}`, {
                method: 'DELETE',
                headers
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Delete failed');
            }

            set(state => {
                const newFolders = { ...state.folders };
                delete newFolders[folderId];
                return { folders: newFolders };
            });

            // If we were inside that folder, go up?
            if (get().currentFolderId === folderId) {
                set({ currentFolderId: 'root' });
                get().loadFolderContents('root');
            }
        } catch (err: any) {
            set({ error: err.message });
        } finally {
            set({ loading: false });
        }
    },

    createFileEntry: async (_name: string, _parentFolderId: string) => {
        // This was used for "Dummy File" creation in the old spec.
        // In the new spec, files are only created via Upload.
        // But if we want to support it for testing:
        alert("Please use the Upload button. Empty file creation is deprecated in this version.");
    },

    renameFile: async (folderId: string, fileId: string, newName: string) => {
        try {
            const headers = await getAuthHeaders();
            const query = folderId ? `?folderId=${folderId}` : '';
            const res = await fetch(`${API_URL}/${fileId}${query}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ name: newName })
            });

            if (!res.ok) throw new Error('Rename file failed');

            set(state => {
                const folderFiles = state.files[folderId] || [];
                const updatedFiles = folderFiles.map(f => f.id === fileId ? { ...f, name: newName } : f);
                return {
                    files: { ...state.files, [folderId]: updatedFiles }
                };
            });
        } catch (err: any) {
            set({ error: err.message });
        }
    },

    deleteFile: async (folderId: string, fileId: string) => {
        try {
            const headers = await getAuthHeaders();
            const query = folderId ? `?folderId=${folderId}` : '';
            const res = await fetch(`${API_URL}/${fileId}${query}`, {
                method: 'DELETE',
                headers
            });

            if (!res.ok) throw new Error('Delete file failed');

            set(state => {
                const folderFiles = state.files[folderId] || [];
                return {
                    files: { ...state.files, [folderId]: folderFiles.filter(f => f.id !== fileId) }
                };
            });
        } catch (err: any) {
            set({ error: err.message });
        }
    },

    setCurrentFolderId: (id) => {
        set({ currentFolderId: id });
        if (id) get().loadFolderContents(id);
    }
}));
