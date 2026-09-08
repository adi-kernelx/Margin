// Local file-tree store.
//
// Drop-in replacement for the Firestore-backed useFileSystemStore: same state
// shape and the same action names, so FileTree.tsx needed only its imports
// changed. Everything is served from IndexedDB, so there is no auth, no
// network, and no loading state that can hang on a request.

import { create } from 'zustand';
import { libraryDB } from '@/lib/storage/library-db';
import { ROOT_FOLDER_ID, type LibraryFile, type LibraryFolder } from '@/types/library';

interface FileSystemState {
    folders: Record<string, LibraryFolder>;   // by folder id
    files: Record<string, LibraryFile[]>;     // by parent folder id
    currentFolderId: string | null;
    loading: boolean;
    error: string | null;

    initialize: () => Promise<void>;
    loadFolderContents: (folderId: string) => Promise<void>;

    createFolder: (name: string, parentId: string | null) => Promise<void>;
    renameFolder: (folderId: string, newName: string) => Promise<void>;
    deleteFolder: (folderId: string, parentFolderId?: string) => Promise<void>;

    renameFile: (folderId: string, fileId: string, newName: string) => Promise<void>;
    deleteFile: (folderId: string, fileId: string) => Promise<void>;

    importFiles: (files: FileList | File[], parentFolderId: string) => Promise<void>;
    openFileBlob: (fileId: string) => Promise<Blob | undefined>;

    setCurrentFolderId: (id: string | null) => void;
}

export const useFileSystemStore = create<FileSystemState>((set, get) => ({
    folders: {},
    files: {},
    currentFolderId: null,
    loading: false,
    error: null,

    initialize: async () => {
        set({ loading: true, error: null });
        try {
            const root = await libraryDB.ensureRoot();
            set((state) => ({
                folders: { ...state.folders, [root.id]: root },
                currentFolderId: state.currentFolderId ?? ROOT_FOLDER_ID,
            }));
            await get().loadFolderContents(ROOT_FOLDER_ID);
        } catch (err) {
            set({ error: err instanceof Error ? err.message : String(err) });
        } finally {
            set({ loading: false });
        }
    },

    loadFolderContents: async (folderId: string) => {
        set({ loading: true, error: null });
        try {
            const [childFolders, folderFiles] = await Promise.all([
                libraryDB.listChildFolders(folderId),
                libraryDB.listFiles(folderId),
            ]);

            const merged: Record<string, LibraryFolder> = {};
            for (const folder of childFolders) merged[folder.id] = folder;

            set((state) => ({
                folders: { ...state.folders, ...merged },
                files: { ...state.files, [folderId]: folderFiles },
            }));
        } catch (err) {
            set({ error: err instanceof Error ? err.message : String(err) });
        } finally {
            set({ loading: false });
        }
    },

    createFolder: async (name: string, parentId: string | null) => {
        const parent = parentId ?? ROOT_FOLDER_ID;
        try {
            const folder = await libraryDB.createFolder(name, parent);
            set((state) => ({ folders: { ...state.folders, [folder.id]: folder } }));
            await get().loadFolderContents(parent);
        } catch (err) {
            set({ error: err instanceof Error ? err.message : String(err) });
        }
    },

    renameFolder: async (folderId: string, newName: string) => {
        try {
            await libraryDB.renameFolder(folderId, newName);
            set((state) => ({
                folders: {
                    ...state.folders,
                    [folderId]: { ...state.folders[folderId], name: newName },
                },
            }));
        } catch (err) {
            set({ error: err instanceof Error ? err.message : String(err) });
        }
    },

    deleteFolder: async (folderId: string, parentFolderId?: string) => {
        if (folderId === ROOT_FOLDER_ID) return;
        try {
            await libraryDB.deleteFolderRecursive(folderId);

            set((state) => {
                const folders = { ...state.folders };
                delete folders[folderId];
                const files = { ...state.files };
                delete files[folderId];
                return { folders, files };
            });

            const fallback = parentFolderId ?? ROOT_FOLDER_ID;
            if (get().currentFolderId === folderId) set({ currentFolderId: fallback });
            await get().loadFolderContents(fallback);
        } catch (err) {
            set({ error: err instanceof Error ? err.message : String(err) });
        }
    },

    renameFile: async (folderId: string, fileId: string, newName: string) => {
        try {
            await libraryDB.renameFile(fileId, newName);
            set((state) => ({
                files: {
                    ...state.files,
                    [folderId]: (state.files[folderId] ?? []).map((f) =>
                        f.id === fileId ? { ...f, name: newName } : f,
                    ),
                },
            }));
        } catch (err) {
            set({ error: err instanceof Error ? err.message : String(err) });
        }
    },

    deleteFile: async (folderId: string, fileId: string) => {
        try {
            await libraryDB.deleteFile(fileId);
            set((state) => ({
                files: {
                    ...state.files,
                    [folderId]: (state.files[folderId] ?? []).filter((f) => f.id !== fileId),
                },
            }));
        } catch (err) {
            set({ error: err instanceof Error ? err.message : String(err) });
        }
    },

    importFiles: async (incoming: FileList | File[], parentFolderId: string) => {
        set({ loading: true, error: null });
        try {
            for (const file of Array.from(incoming)) {
                await libraryDB.importFile(file, parentFolderId);
            }
            await get().loadFolderContents(parentFolderId);
        } catch (err) {
            set({ error: err instanceof Error ? err.message : String(err) });
        } finally {
            set({ loading: false });
        }
    },

    openFileBlob: (fileId: string) => libraryDB.getFileBlob(fileId),

    setCurrentFolderId: (id) => {
        set({ currentFolderId: id });
        if (id) void get().loadFolderContents(id);
    },
}));
