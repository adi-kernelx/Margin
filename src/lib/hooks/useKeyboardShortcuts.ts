import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';


interface UseKeyboardShortcutsOptions {
    onUndo?: () => void;
    onRedo?: () => void;
    onDelete?: () => void;
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions = {}) {
    const { setAnnotationMode } = useAppStore();
    const { onUndo, onRedo, onDelete } = options;

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't trigger shortcuts when typing in inputs
            if (
                e.target instanceof HTMLInputElement ||
                e.target instanceof HTMLTextAreaElement ||
                (e.target instanceof HTMLElement && e.target.isContentEditable)
            ) {
                return;
            }

            // Tool shortcuts (single key)
            if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                switch (e.key.toLowerCase()) {
                    case 'v':
                        e.preventDefault();
                        setAnnotationMode('select');
                        return;
                    case 'p':
                        e.preventDefault();
                        setAnnotationMode('pencil');
                        return;
                    case 'h':
                        e.preventDefault();
                        setAnnotationMode('highlighter');
                        return;
                    case 't':
                        e.preventDefault();
                        setAnnotationMode('text');
                        return;
                    case 'e':
                        e.preventDefault();
                        setAnnotationMode('eraser');
                        return;
                    case 'r':
                        e.preventDefault();
                        setAnnotationMode('rectangle');
                        return;
                    case 'a':
                        e.preventDefault();
                        setAnnotationMode('arrow');
                        return;
                    case 'Escape':
                        e.preventDefault();
                        setAnnotationMode('select');
                        return;
                }
            }

            // Undo/Redo shortcuts
            if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
                if (e.key === 'z' || e.key === 'Z') {
                    e.preventDefault();
                    onUndo?.();
                    return;
                }
                if (e.key === 'y' || e.key === 'Y') {
                    e.preventDefault();
                    onRedo?.();
                    return;
                }
            }

            // Delete shortcut
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    onDelete?.();
                    return;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [setAnnotationMode, onUndo, onRedo, onDelete]);
}


