import { useContext } from 'react';
import { useStore } from 'zustand';
import { DocumentContext } from '@/contexts/DocumentContext';
import { useAppStore } from '@/lib/store';
import type { AppState } from '@/lib/store';

export function useDocumentStore<T>(selector: (state: AppState) => T): T;
export function useDocumentStore(): AppState;
export function useDocumentStore<T>(selector?: (state: AppState) => T) {
    const docStore = useContext(DocumentContext);

    if (docStore) {
        // useStore handles the selector being optional
        return useStore(docStore, selector!);
    }

    // Fallback to global store (verify this is intended)
    // console.warn("useDocumentStore: DocumentContext is null, falling back to global store.");
    return useAppStore(selector!);
}
