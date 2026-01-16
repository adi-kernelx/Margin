import { create } from 'zustand';


interface UserInfo {
    name: string;
    email?: string;
    uid: string;
    color: string;
    fileId: string;
    connectedAt: number;
}

interface CollabStoreState {
    // Map<fileId, UserInfo[]>
    activeUsers: Record<string, UserInfo[]>;

    // Actions
    updateUsers: (fileId: string, users: UserInfo[]) => void;
    clearUsers: (fileId: string) => void;
}

export const useCollabStore = create<CollabStoreState>((set) => ({
    activeUsers: {},

    updateUsers: (fileId, users) => set((state) => ({
        activeUsers: {
            ...state.activeUsers,
            [fileId]: users
        }
    })),

    clearUsers: (fileId) => set((state) => {
        const next = { ...state.activeUsers };
        delete next[fileId];
        return { activeUsers: next };
    })
}));
