// The action registry: one list of everything the user can do, feeding the
// command palette (Ctrl+K), the shortcut sheet (?), and global key bindings.
//
// Components register the commands they own while mounted, so the palette
// only offers what is currently possible — a document's "Toggle notes" exists
// only while that document is focused.

import { useEffect, useLayoutEffect, useRef } from 'react';
import { create } from 'zustand';

export type CommandGroup = 'Workspace' | 'Document' | 'Tools' | 'Appearance' | 'Help';

export interface Command {
    id: string;
    title: string;
    group: CommandGroup;
    /** Extra words the palette should match, e.g. "dark" for a theme command. */
    keywords?: string[];
    /** Display and binding, e.g. "Mod+K". */
    shortcut?: string;
    /**
     * False when another handler already owns the key (the annotation tool
     * keys live in useKeyboardShortcuts); the shortcut is then shown in the
     * palette and sheet but not bound a second time.
     */
    bindKey?: boolean;
    /** Allow the shortcut to fire while typing in a field (for Mod+ combos). */
    allowInInput?: boolean;
    enabled?: boolean;
    run: () => void;
}

interface CommandState {
    sources: Map<string, Command[]>;
    setSource: (source: string, commands: Command[]) => void;
    removeSource: (source: string) => void;
}

export const useCommandStore = create<CommandState>((set) => ({
    sources: new Map(),
    setSource: (source, commands) => set(state => {
        const sources = new Map(state.sources);
        sources.set(source, commands);
        return { sources };
    }),
    removeSource: (source) => set(state => {
        const sources = new Map(state.sources);
        sources.delete(source);
        return { sources };
    }),
}));

const GROUP_ORDER: CommandGroup[] = ['Workspace', 'Document', 'Tools', 'Appearance', 'Help'];

export function selectCommands(sources: Map<string, Command[]>): Command[] {
    const all = [...sources.values()].flat().filter(command => command.enabled !== false);
    return all.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Registers `commands` under `source` while the calling component is mounted.
 * The latest `run` closures are always used, so callers need not memoise.
 */
export function useRegisterCommands(source: string, commands: Command[], active = true): void {
    const latest = useRef(commands);
    useLayoutEffect(() => {
        latest.current = commands;
    });
    const signature = active ? commands.map(command => `${command.id}:${command.enabled !== false}:${command.title}`).join('|') : '';

    useEffect(() => {
        const { setSource, removeSource } = useCommandStore.getState();
        if (!active) {
            removeSource(source);
            return;
        }
        // Wrap each run so the registry never holds a stale closure.
        setSource(source, latest.current.map((command, index) => ({
            ...command,
            run: () => latest.current[index]?.run(),
        })));
        return () => removeSource(source);
    }, [source, signature, active]);
}
