import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Command as CommandIcon, CornerDownLeft, Search } from 'lucide-react';
import { fuzzyMatch, fuzzyRank } from '@/core/ui/fuzzy';
import { isEditableTarget, matchesShortcut } from '@/core/ui/shortcuts';
import { groupBy } from '@/core/search/snippet';
import { IS_MAC, selectCommands, useCommandStore, useRegisterCommands, type Command } from '@/lib/commands/registry';
import { useUiStore } from '@/lib/ui/ui-store';
import { cn } from '@/lib/utils';
import { Dialog } from './ui/Dialog';
import { KeyCaps } from './KeyCaps';
import { EmptyState } from './ui/States';

function Highlighted({ text, positions }: { text: string; positions: number[] }) {
    if (!positions.length) return <>{text}</>;
    const marked = new Set(positions);
    return <>{[...text].map((character, index) => marked.has(index)
        ? <mark key={index} className="bg-transparent font-semibold text-accent">{character}</mark>
        : <span key={index}>{character}</span>)}</>;
}

function CommandPalette() {
    const open = useUiStore(state => state.paletteOpen);
    // Mounted fresh on every open, so the query and selection start empty.
    return open ? <PaletteBody /> : null;
}

function PaletteBody() {
    const setOpen = useUiStore(state => state.setPaletteOpen);
    const sources = useCommandStore(state => state.sources);
    const commands = useMemo(() => selectCommands(sources), [sources]);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const listId = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const previousFocus = useRef<HTMLElement | null>(null);

    const ranked = useMemo(
        () => fuzzyRank(query, commands, command => [command.title, `${command.group} ${command.title}`, ...(command.keywords ?? [])]),
        [query, commands],
    );

    useEffect(() => {
        previousFocus.current = document.activeElement as HTMLElement | null;
        requestAnimationFrame(() => inputRef.current?.focus());
        return () => previousFocus.current?.focus?.();
    }, []);

    useEffect(() => {
        listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    const execute = (command: Command) => {
        setOpen(false);
        // Let the palette unmount and focus return before the command runs,
        // so a command that opens a dialog receives focus correctly.
        requestAnimationFrame(() => command.run());
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex(index => Math.min(ranked.length - 1, index + 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex(index => Math.max(0, index - 1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const target = ranked[activeIndex];
            if (target) execute(target.item);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
        } else if (event.key === 'Tab') {
            event.preventDefault();
        }
    };

    // Grouped only when browsing; a typed query shows one ranked list. Each
    // entry carries its position in `ranked`, which is also visual order.
    const indexed = ranked.map((entry, index) => ({ ...entry, index }));
    const groups = query.trim() ? [{ key: 'Results', items: indexed }] : groupBy(indexed, entry => entry.item.group);

    return createPortal(
        <div
            className="fixed inset-0 z-dialog flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-[2px] animate-[dialog-scrim_var(--dur-surface)_var(--ease)]"
            onPointerDown={event => { if (event.target === event.currentTarget) setOpen(false); }}
        >
            <div role="dialog" aria-modal="true" aria-label="Command palette" className="depth-dialog w-full max-w-xl overflow-hidden border border-line animate-[dialog-in_var(--dur-entrance)_var(--ease)]">
                <div className="flex items-center gap-2 border-b border-line-soft px-4">
                    <Search size={16} className="shrink-0 text-text-muted" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={event => { setQuery(event.target.value); setActiveIndex(0); }}
                        onKeyDown={onKeyDown}
                        placeholder="Type a command…"
                        role="combobox"
                        aria-expanded="true"
                        aria-controls={listId}
                        aria-activedescendant={ranked[activeIndex] ? `${listId}-${activeIndex}` : undefined}
                        className="h-12 flex-1 bg-transparent text-base text-text outline-none placeholder:text-text-muted"
                    />
                    <kbd className="keycap">Esc</kbd>
                </div>
                <div ref={listRef} id={listId} role="listbox" aria-label="Commands" className="max-h-[55vh] overflow-y-auto p-2">
                    {ranked.length === 0 && <EmptyState compact title="No matching command" description="Try fewer letters, or a word like “theme” or “pages”." />}
                    {groups.map(group => (
                        <div key={group.key} role="group" aria-label={group.key} className="mb-1">
                            <div className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-text-muted">{group.key}</div>
                            {group.items.map(({ item, index }) => {
                                const active = index === activeIndex;
                                return (
                                    <div
                                        key={item.id}
                                        id={`${listId}-${index}`}
                                        data-index={index}
                                        role="option"
                                        aria-selected={active}
                                        onPointerMove={() => setActiveIndex(index)}
                                        onClick={() => execute(item)}
                                        className={cn(
                                            'flex h-10 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 text-sm transition-colors duration-state',
                                            active ? 'bg-accent-soft text-text shadow-elev-1' : 'text-text-soft',
                                        )}
                                    >
                                        <span className="truncate"><Highlighted text={item.title} positions={query.trim() ? fuzzyMatch(query, item.title)?.positions ?? [] : []} /></span>
                                        <span className="flex shrink-0 items-center gap-2">
                                            {item.shortcut && <KeyCaps shortcut={item.shortcut} />}
                                            {active && <CornerDownLeft size={14} className="text-accent" />}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>,
        document.body,
    );
}

function ShortcutSheet() {
    const open = useUiStore(state => state.shortcutsOpen);
    const setOpen = useUiStore(state => state.setShortcutsOpen);
    const sources = useCommandStore(state => state.sources);
    const withKeys = useMemo(() => selectCommands(sources).filter(command => command.shortcut), [sources]);

    return (
        <Dialog open={open} onClose={() => setOpen(false)} size="lg" icon={<CommandIcon size={16} />} title="Keyboard shortcuts" description="Every action is also in the command palette.">
            <ShortcutList commands={withKeys} />
        </Dialog>
    );
}

export function ShortcutList({ commands }: { commands: Command[] }) {
    if (!commands.length) return <EmptyState compact title="No shortcuts registered" />;
    return (
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {groupBy(commands, command => command.group).map(group => (
                <section key={group.key}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">{group.key}</h3>
                    <dl className="space-y-1.5">
                        {group.items.map(command => (
                            <div key={command.id} className="flex items-center justify-between gap-3 text-sm">
                                <dt className="truncate text-text-soft">{command.title}</dt>
                                <dd><KeyCaps shortcut={command.shortcut!} /></dd>
                            </div>
                        ))}
                    </dl>
                </section>
            ))}
        </div>
    );
}

/**
 * Mounts the palette and shortcut sheet and binds every registered shortcut
 * on one window listener. Registered once, near the root.
 */
export function CommandLayer() {
    const setPaletteOpen = useUiStore(state => state.setPaletteOpen);
    const setShortcutsOpen = useUiStore(state => state.setShortcutsOpen);

    useRegisterCommands('command-layer', [
        { id: 'help.palette', title: 'Command palette', group: 'Help', shortcut: 'Mod+K', allowInInput: true, run: () => setPaletteOpen(true) },
        { id: 'help.shortcuts', title: 'Keyboard shortcuts', group: 'Help', shortcut: '?', keywords: ['keys', 'help'], run: () => setShortcutsOpen(true) },
    ]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.repeat) return;
            const ui = useUiStore.getState();
            if (ui.paletteOpen) return;
            const target = event.target as HTMLElement | null;
            const typing = isEditableTarget(target?.tagName, Boolean(target?.isContentEditable));
            // While any modal dialog is open only the palette toggle stays live.
            const dialogOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
            for (const command of selectCommands(useCommandStore.getState().sources)) {
                if (!command.shortcut || command.bindKey === false) continue;
                if (typing && !command.allowInInput) continue;
                if (dialogOpen && command.id !== 'help.palette') continue;
                if (!matchesShortcut(event, command.shortcut, IS_MAC)) continue;
                event.preventDefault();
                command.run();
                return;
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    return (
        <>
            <CommandPalette />
            <ShortcutSheet />
        </>
    );
}
