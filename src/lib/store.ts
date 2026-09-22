import { create } from 'zustand';

export type ToolMode =
    | 'select'
    | 'pencil'
    | 'highlighter'
    | 'text'
    | 'eraser'
    | 'partial-eraser'
    | 'rectangle'
    | 'arrow'
    | 'image'
    | 'math'
    | null;

export type HighlighterMode = 'freeform' | 'text-aware';
export type EraserMode = 'stroke' | 'point';
export type SelectionMode = 'auto' | 'text' | 'annotations' | 'text-annotation';

export interface AppState {
    currentWorkspace: any | null;
    setCurrentWorkspace: (workspace: any | null) => void;
    currentFile: File | null;
    setCurrentFile: (file: File | null) => void;
    annotationMode: ToolMode;
    setAnnotationMode: (mode: ToolMode) => void;
    isDarkMode: boolean;
    toggleDarkMode: () => void;
    /**
     * Optional CSS filter applied to rendered page canvases. Never modifies
     * the underlying PDF; exports carry the original pixels.
     */
    readingFilter: 'none' | 'dim' | 'sepia';
    setReadingFilter: (filter: 'none' | 'dim' | 'sepia') => void;
    highlighterMode: HighlighterMode;
    setHighlighterMode: (mode: HighlighterMode) => void;
    highlighterColor: string;
    setHighlighterColor: (color: string) => void;
    highlighterOpacity: number;
    setHighlighterOpacity: (opacity: number) => void;
    highlighterWidth: number;
    setHighlighterWidth: (width: number) => void;
    eraserMode: EraserMode;
    setEraserMode: (mode: EraserMode) => void;
    // Pencil, Rectangle, and Arrow colors
    pencilColor: string;
    setPencilColor: (color: string) => void;
    pencilWidth: number;
    setPencilWidth: (width: number) => void;
    rectangleColor: string;
    setRectangleColor: (color: string) => void;
    rectangleWidth: number;
    setRectangleWidth: (width: number) => void;
    arrowColor: string;
    setArrowColor: (color: string) => void;
    arrowWidth: number;
    setArrowWidth: (width: number) => void;
    // Text tool settings
    textColor: string;
    setTextColor: (color: string) => void;
    textBackgroundColor: string; // 'transparent' or rgba string
    setTextBackgroundColor: (color: string) => void;
    textFontSize: number;
    setTextFontSize: (size: number) => void;
    textFontFamily: string;
    setTextFontFamily: (family: string) => void;
    textBold: boolean;
    setTextBold: (bold: boolean) => void;
    textItalic: boolean;
    setTextItalic: (italic: boolean) => void;
    textUnderline: boolean;
    setTextUnderline: (underline: boolean) => void;
    textSubscript: boolean;
    setTextSubscript: (subscript: boolean) => void;
    textSuperscript: boolean;
    setTextSuperscript: (superscript: boolean) => void;
    // Selection mode
    selectionMode: SelectionMode;
    setSelectionMode: (mode: SelectionMode) => void;
    // Awaiting Image Placement (Global state for cross-page placement)
    awaitingImagePlacement: { imageData: string } | null;
    setAwaitingImagePlacement: (data: { imageData: string } | null) => void;
    awaitingMathPlacement: { content: string; displayMode: boolean } | null;
    setAwaitingMathPlacement: (data: { content: string; displayMode: boolean } | null) => void;
    editingMathAnnotation: { id: string, content: string, displayMode: boolean } | null;
    setEditingMathAnnotation: (data: { id: string, content: string, displayMode: boolean } | null) => void;
    isMathModalOpen: boolean;
    setMathModalOpen: (isOpen: boolean) => void;
    // Save/Export State
    isDirty: boolean;
    setIsDirty: (isDirty: boolean) => void;
    autoSaveEnabled: boolean;
    setAutoSaveEnabled: (enabled: boolean) => void;
    isSaving: boolean;
    setIsSaving: (isSaving: boolean) => void;
    lastSavedAt: number | null;
    setLastSavedAt: (time: number | null) => void;

    // File Handle State
    fileHandle: any | null; // FileSystemFileHandle
    setFileHandle: (handle: any | null) => void;
    fileSource: 'local' | 'remote';
    setFileSource: (source: 'local' | 'remote') => void;
    // Zoom State
    scale: number;
    setScale: (scale: number) => void;
    // Multi-doc support
    focusedDocId: string | null;
    setFocusedDocId: (id: string | null) => void;
    // Search highlight
    searchHighlight: {
        docId: string;
        page: number;
        bbox: { x0: number; y0: number; x1: number; y1: number };
        spans?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; char_start?: number; char_end?: number }>;
    } | null;
    setSearchHighlight: (highlight: {
        docId: string;
        page: number;
        bbox: { x0: number; y0: number; x1: number; y1: number };
        spans?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; char_start?: number; char_end?: number }>;
    } | null) => void;
    clearSearchHighlight: () => void;
}

export const createAppStoreSlice = (set: any, _get: any): AppState => ({
    currentWorkspace: null,
    setCurrentWorkspace: (workspace) => set({ currentWorkspace: workspace }),
    currentFile: null,
    setCurrentFile: (file) => set({ currentFile: file }),
    annotationMode: null,
    setAnnotationMode: (mode) => set({ annotationMode: mode }),
    isDarkMode: false,
    // Delegates to the theme store, which persists the preference and applies
    // the class. The isDarkMode field above is a read-only mirror kept in sync
    // by ThemeProvider; components should prefer useThemeStore in new code.
    toggleDarkMode: () => {
        void import('@/lib/theme/theme').then(({ useThemeStore }) => {
            const store = useThemeStore.getState();
            store.setPreference(store.resolved === 'dark' ? 'light' : 'dark');
        });
    },
    readingFilter: 'none',
    setReadingFilter: (filter) => set({ readingFilter: filter }),
    highlighterMode: 'freeform',
    setHighlighterMode: (mode) => set({ highlighterMode: mode }),
    highlighterColor: '#FFEB3B', // Default yellow
    setHighlighterColor: (color) => set({ highlighterColor: color }),
    highlighterOpacity: 0.25,
    setHighlighterOpacity: (opacity) => set({ highlighterOpacity: opacity }),
    highlighterWidth: 12,
    setHighlighterWidth: (width) => set({ highlighterWidth: width }),
    eraserMode: 'stroke',
    setEraserMode: (mode) => set({ eraserMode: mode }),
    // Tool colors
    pencilColor: '#000000', // Black
    setPencilColor: (color) => set({ pencilColor: color }),
    pencilWidth: 2,
    setPencilWidth: (width) => set({ pencilWidth: width }),
    rectangleColor: '#FF0000', // Red
    setRectangleColor: (color) => set({ rectangleColor: color }),
    rectangleWidth: 2,
    setRectangleWidth: (width) => set({ rectangleWidth: width }),
    arrowColor: '#0000FF', // Blue
    setArrowColor: (color) => set({ arrowColor: color }),
    arrowWidth: 2,
    setArrowWidth: (width) => set({ arrowWidth: width }),
    // Text tool settings
    textColor: '#000000', // Black
    setTextColor: (color) => set({ textColor: color }),
    textBackgroundColor: 'transparent',
    textFontSize: 16,
    setTextFontSize: (size) => set({ textFontSize: size }),
    setTextBackgroundColor: (color) => set({ textBackgroundColor: color }),
    textFontFamily: 'system-ui, -apple-system, sans-serif',
    setTextFontFamily: (family) => set({ textFontFamily: family }),
    textBold: false,
    setTextBold: (bold) => set({ textBold: bold }),
    textItalic: false,
    setTextItalic: (italic) => set({ textItalic: italic }),
    textUnderline: false,
    setTextUnderline: (underline) => set({ textUnderline: underline }),
    textSubscript: false,
    setTextSubscript: (subscript) => set({ textSubscript: subscript }),
    textSuperscript: false,
    setTextSuperscript: (superscript) => set({ textSuperscript: superscript }),
    // Selection mode
    selectionMode: 'text',
    setSelectionMode: (mode) => set({ selectionMode: mode }),
    // Awaiting Image Placement
    awaitingImagePlacement: null,
    setAwaitingImagePlacement: (data) => set({ awaitingImagePlacement: data }),
    awaitingMathPlacement: null,
    setAwaitingMathPlacement: (data) => set({ awaitingMathPlacement: data }),
    editingMathAnnotation: null,
    setEditingMathAnnotation: (data) => set({ editingMathAnnotation: data }),
    isMathModalOpen: false,
    setMathModalOpen: (isOpen) => set({ isMathModalOpen: isOpen }),
    // Save/Export State
    isDirty: false,
    setIsDirty: (isDirty) => set({ isDirty }),
    autoSaveEnabled: false,
    setAutoSaveEnabled: (enabled) => set({ autoSaveEnabled: enabled }),
    isSaving: false,
    setIsSaving: (isSaving) => set({ isSaving }),
    lastSavedAt: null,
    setLastSavedAt: (time) => set({ lastSavedAt: time }),

    // File Handle State
    fileHandle: null,
    setFileHandle: (handle) => set({ fileHandle: handle }),
    fileSource: 'remote',
    setFileSource: (source) => set({ fileSource: source }),
    // Zoom State
    scale: 1,
    setScale: (scale) => set({ scale: scale }),
    focusedDocId: null,
    setFocusedDocId: (id) => set({ focusedDocId: id }),
    // Search highlight
    searchHighlight: null,
    setSearchHighlight: (highlight) => set({ searchHighlight: highlight }),
    clearSearchHighlight: () => set({ searchHighlight: null }),
});

export const useAppStore = create<AppState>((set, get) => createAppStoreSlice(set, get));

// Expose store for debugging
if (typeof window !== 'undefined') {
    (window as any).useAppStore = useAppStore;
}
