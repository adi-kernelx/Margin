// Theme selection.
//
// Three states: 'system' follows prefers-color-scheme and updates live;
// 'light' and 'dark' are the user's explicit override. The choice is
// persisted under one key so an inline script in index.html can restore it
// before the first paint, avoiding a light flash on reload for dark users.

import { create } from 'zustand';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'margin:theme';

/** Kept in sync with the string the inline pre-hydration script reads. */
export const THEME_STORAGE_KEY = STORAGE_KEY;

/**
 * Reads the persisted preference, defaulting to 'system'. Safe in Node — a
 * missing window returns the default rather than throwing, so tests and the
 * design gallery's SSR-lite entry point work.
 */
export function readStoredPreference(): ThemePreference {
    if (typeof window === 'undefined') return 'system';
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
    } catch {
        // Access to localStorage can throw in restricted contexts; the
        // preference simply falls back to system.
    }
    return 'system';
}

/** Resolves a preference to the concrete theme currently in effect. */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
    if (preference !== 'system') return preference;
    if (typeof window === 'undefined' || !window.matchMedia) return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Applies the theme by toggling the `dark` class on the documentElement. */
export function applyTheme(theme: ResolvedTheme): void {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
}

interface ThemeState {
    preference: ThemePreference;
    resolved: ResolvedTheme;
    setPreference: (preference: ThemePreference) => void;
    /** Called by the ThemeProvider when the system query changes. */
    onSystemChange: (isDark: boolean) => void;
}

/**
 * Zustand store so any component can read the current theme without
 * re-implementing the resolution. The store's initial values come from
 * localStorage and the system query; the ThemeProvider keeps them in sync.
 */
export const useThemeStore = create<ThemeState>((set, get) => {
    const preference = readStoredPreference();
    const resolved = resolveTheme(preference);
    return {
        preference,
        resolved,
        setPreference: (next: ThemePreference) => {
            if (typeof window !== 'undefined') {
                try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
            }
            const resolved = resolveTheme(next);
            set({ preference: next, resolved });
            applyTheme(resolved);
        },
        onSystemChange: (isDark: boolean) => {
            if (get().preference !== 'system') return;
            const resolved: ResolvedTheme = isDark ? 'dark' : 'light';
            set({ resolved });
            applyTheme(resolved);
        },
    };
});
