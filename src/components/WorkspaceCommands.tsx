import { useAppStore } from '@/lib/store';
import { useRegisterCommands } from '@/lib/commands/registry';
import { useThemeStore } from '@/lib/theme/theme';
import { requestSearchFocus, useUiStore } from '@/lib/ui/ui-store';
import type { DocumentEntry } from '@/types';
import { ASSISTANT_ENABLED, SERVICES_ENABLED } from '@/lib/features';

interface WorkspaceCommandsProps {
    documents: DocumentEntry[];
    focusedDocId: string | null;
    assistantOpen: boolean;
    onOpenPdf: () => void;
    onShowLibrary: () => void;
    onToggleAssistant: () => void;
    onCloseDocument: (docId: string) => void;
    onFocusDocument: (docId: string) => void;
}

/**
 * Registers the workspace-level actions (chrome, tools, appearance) with the
 * command registry. Renders nothing; it exists so Dashboard stays a layout.
 */
export function WorkspaceCommands({
    documents,
    focusedDocId,
    assistantOpen,
    onOpenPdf,
    onShowLibrary,
    onToggleAssistant,
    onCloseDocument,
    onFocusDocument,
}: WorkspaceCommandsProps) {
    const setAnnotationMode = useAppStore(state => state.setAnnotationMode);
    const setReadingFilter = useAppStore(state => state.setReadingFilter);
    const setThemePreference = useThemeStore(state => state.setPreference);
    const openSettings = useUiStore(state => state.openSettings);

    useRegisterCommands('workspace', [
        { id: 'workspace.open', title: 'Open and add PDF', group: 'Workspace', shortcut: 'Mod+O', allowInInput: true, keywords: ['import', 'file'], run: onOpenPdf },
        { id: 'workspace.library', title: 'Show library', group: 'Workspace', shortcut: 'Mod+Shift+L', keywords: ['home', 'files'], run: onShowLibrary },
        { id: 'workspace.search', title: 'Search documents', group: 'Workspace', shortcut: 'Mod+F', allowInInput: true, keywords: ['find'], run: requestSearchFocus },
        { id: 'workspace.assistant', title: assistantOpen ? 'Hide assistant' : 'Show assistant', group: 'Workspace', shortcut: 'Mod+J', allowInInput: true, keywords: ['ai', 'chat', 'ask'], enabled: ASSISTANT_ENABLED, run: onToggleAssistant },
        { id: 'workspace.settings', title: 'Open settings', group: 'Workspace', shortcut: 'Mod+,', allowInInput: true, keywords: ['preferences'], run: () => openSettings() },
        { id: 'workspace.services', title: 'Check service connections', group: 'Workspace', keywords: ['ocr', 'health', 'offline'], enabled: SERVICES_ENABLED, run: () => openSettings('services') },
        { id: 'workspace.storage', title: 'Storage usage', group: 'Workspace', keywords: ['disk', 'persist', 'quota'], run: () => openSettings('storage') },
        { id: 'workspace.close', title: 'Close focused document', group: 'Workspace', enabled: Boolean(focusedDocId), run: () => { if (focusedDocId) onCloseDocument(focusedDocId); } },
        ...documents.map(doc => ({ id: `workspace.focus.${doc.id}`, title: `Switch to ${doc.name}`, group: 'Workspace' as const, keywords: ['tab', 'document'], run: () => onFocusDocument(doc.id) })),
        // Tool keys are bound by useKeyboardShortcuts; listed here for the palette and sheet.
        { id: 'tools.select', title: 'Select tool', group: 'Tools', shortcut: 'V', bindKey: false, run: () => setAnnotationMode('select') },
        { id: 'tools.pencil', title: 'Pencil', group: 'Tools', shortcut: 'P', bindKey: false, keywords: ['draw', 'ink', 'pen'], run: () => setAnnotationMode('pencil') },
        { id: 'tools.highlighter', title: 'Highlighter', group: 'Tools', shortcut: 'H', bindKey: false, keywords: ['mark'], run: () => setAnnotationMode('highlighter') },
        { id: 'tools.text', title: 'Text box', group: 'Tools', shortcut: 'T', bindKey: false, keywords: ['type', 'write'], run: () => setAnnotationMode('text') },
        { id: 'tools.eraser', title: 'Eraser', group: 'Tools', shortcut: 'E', bindKey: false, run: () => setAnnotationMode('eraser') },
        { id: 'tools.rectangle', title: 'Rectangle', group: 'Tools', shortcut: 'R', bindKey: false, keywords: ['shape', 'box'], run: () => setAnnotationMode('rectangle') },
        { id: 'tools.arrow', title: 'Arrow', group: 'Tools', shortcut: 'A', bindKey: false, keywords: ['shape'], run: () => setAnnotationMode('arrow') },
        { id: 'tools.image', title: 'Image', group: 'Tools', keywords: ['picture', 'paste'], run: () => setAnnotationMode('image') },
        { id: 'tools.math', title: 'Math equation', group: 'Tools', keywords: ['latex', 'formula', 'katex'], run: () => setAnnotationMode('math') },
        { id: 'appearance.system', title: 'Theme: follow system', group: 'Appearance', keywords: ['auto'], run: () => setThemePreference('system') },
        { id: 'appearance.light', title: 'Theme: light', group: 'Appearance', run: () => setThemePreference('light') },
        { id: 'appearance.dark', title: 'Theme: dark', group: 'Appearance', keywords: ['night'], run: () => setThemePreference('dark') },
        { id: 'appearance.filter-off', title: 'Reading filter: off', group: 'Appearance', run: () => setReadingFilter('none') },
        { id: 'appearance.filter-dim', title: 'Reading filter: dim', group: 'Appearance', keywords: ['night', 'dark'], run: () => setReadingFilter('dim') },
        { id: 'appearance.filter-sepia', title: 'Reading filter: sepia', group: 'Appearance', keywords: ['warm', 'paper'], run: () => setReadingFilter('sepia') },
    ]);

    return null;
}
