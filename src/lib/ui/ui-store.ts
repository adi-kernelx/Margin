// Transient UI state shared across the chrome: which global overlays are
// open. Kept apart from the app store so opening the palette never
// re-renders the reading zone.

import { create } from 'zustand';

export type SettingsSection = 'appearance' | 'services' | 'storage' | 'shortcuts' | 'about';

interface UiState {
    paletteOpen: boolean;
    shortcutsOpen: boolean;
    settingsOpen: boolean;
    settingsSection: SettingsSection;
    setPaletteOpen: (open: boolean) => void;
    setShortcutsOpen: (open: boolean) => void;
    openSettings: (section?: SettingsSection) => void;
    closeSettings: () => void;
    setSettingsSection: (section: SettingsSection) => void;
}

export const useUiStore = create<UiState>((set) => ({
    paletteOpen: false,
    shortcutsOpen: false,
    settingsOpen: false,
    settingsSection: 'appearance',
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
    openSettings: (section) => set(state => ({ settingsOpen: true, settingsSection: section ?? state.settingsSection })),
    closeSettings: () => set({ settingsOpen: false }),
    setSettingsSection: (settingsSection) => set({ settingsSection }),
}));

/** Event the header search listens for, so any surface can focus it. */
export const FOCUS_SEARCH_EVENT = 'margin:focus-search';

export function requestSearchFocus(): void {
    window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT));
}
