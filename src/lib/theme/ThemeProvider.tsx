// ThemeProvider — the single place that watches prefers-color-scheme.
//
// Renders no chrome; it exists purely to keep the theme store aligned with
// the system query, and to mirror the resolved theme back into the legacy
// `isDarkMode` flag on the app store so pre-F2 components keep rendering
// while they wait to be migrated.

import { useEffect } from 'react';
import { applyTheme, useThemeStore } from './theme';
import { useAppStore } from '@/lib/store';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const resolved = useThemeStore(state => state.resolved);
    const onSystemChange = useThemeStore(state => state.onSystemChange);

    useEffect(() => {
        applyTheme(resolved);
        // Keep the legacy flag in sync so nothing reading useAppStore() sees
        // the pre-F1 default. Removed piecewise as components migrate.
        useAppStore.setState({ isDarkMode: resolved === 'dark' });
    }, [resolved]);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const query = window.matchMedia('(prefers-color-scheme: dark)');
        const listener = (event: MediaQueryListEvent) => onSystemChange(event.matches);
        query.addEventListener('change', listener);
        return () => query.removeEventListener('change', listener);
    }, [onSystemChange]);

    return <>{children}</>;
}
