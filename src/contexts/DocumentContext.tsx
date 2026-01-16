import { createContext, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { createStore } from 'zustand';
import type { StoreApi } from 'zustand';
import { createAppStoreSlice } from '@/lib/store';
import type { AppState } from '@/lib/store';

export const DocumentContext = createContext<StoreApi<AppState> | null>(null);

interface DocumentProviderProps {
    initialState?: Partial<AppState>;
}

export function DocumentProvider({ children, initialState }: PropsWithChildren<DocumentProviderProps>) {
    const [store] = useState(() => createStore<AppState>((set, get) => {
        const baseState = createAppStoreSlice(set, get);

        // Filter out functions from initialState to prevent overwriting local setters with global ones
        const sanitizedInitialState = initialState ? Object.fromEntries(
            Object.entries(initialState).filter(([_, value]) => typeof value !== 'function')
        ) : {};

        return {
            ...baseState,
            ...sanitizedInitialState,
        };
    }));

    return (
        <DocumentContext.Provider value={store}>
            {children}
        </DocumentContext.Provider>
    );
}
