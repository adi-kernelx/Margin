import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Lightbulb, ListTree, StickyNote, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from './ui/IconButton';

import { dockTabKey, type DockTab } from '@/lib/ui/dock';

export type { DockTab };

const WIDTH_KEY = 'margin:dock-width';
const MIN_WIDTH = 280;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 340;

function readWidth(): number {
    try {
        const stored = Number(window.localStorage.getItem(WIDTH_KEY));
        return Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH ? stored : DEFAULT_WIDTH;
    } catch {
        return DEFAULT_WIDTH;
    }
}

interface DocumentDockProps {
    documentId: string;
    tab: DockTab;
    onTabChange: (tab: DockTab) => void;
    onClose: () => void;
    notes: ReactNode;
    outline: ReactNode;
    knowledge: ReactNode;
    noteCount: number;
}

const tabs: { id: DockTab; label: string; icon: ReactNode }[] = [
    { id: 'notes', label: 'Notes', icon: <StickyNote size={14} /> },
    { id: 'outline', label: 'Outline', icon: <ListTree size={14} /> },
    { id: 'knowledge', label: 'Knowledge', icon: <Lightbulb size={14} /> },
];

/**
 * The per-document right-hand dock. Elevation 1, resizable from its left
 * edge by pointer or keyboard, width shared across documents and remembered.
 */
export function DocumentDock({ documentId, tab, onTabChange, onClose, notes, outline, knowledge, noteCount }: DocumentDockProps) {
    const [width, setWidth] = useState(readWidth);
    const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

    useEffect(() => {
        try {
            window.localStorage.setItem(dockTabKey(documentId), tab);
        } catch {
            // Non-essential preference.
        }
    }, [documentId, tab]);

    const commitWidth = useCallback((next: number) => {
        const clamped = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
        setWidth(clamped);
        try {
            window.localStorage.setItem(WIDTH_KEY, String(clamped));
        } catch {
            // Non-essential preference.
        }
    }, []);

    return (
        <aside
            aria-label="Document panel"
            className="relative flex h-full shrink-0 flex-col border-l border-line bg-surface-1 text-text shadow-elev-2 animate-[panel-in_var(--dur-surface)_var(--ease)]"
            style={{ width }}
        >
            <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize panel"
                aria-valuemin={MIN_WIDTH}
                aria-valuemax={MAX_WIDTH}
                aria-valuenow={width}
                tabIndex={0}
                className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 after:bg-transparent after:transition-colors hover:after:bg-accent focus-visible:after:bg-accent"
                onPointerDown={event => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    dragRef.current = { startX: event.clientX, startWidth: width };
                }}
                onPointerMove={event => {
                    if (!dragRef.current) return;
                    setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + dragRef.current.startX - event.clientX)));
                }}
                onPointerUp={event => {
                    if (!dragRef.current) return;
                    commitWidth(dragRef.current.startWidth + dragRef.current.startX - event.clientX);
                    dragRef.current = null;
                }}
                onKeyDown={event => {
                    if (event.key === 'ArrowLeft') commitWidth(width + 16);
                    else if (event.key === 'ArrowRight') commitWidth(width - 16);
                }}
            />
            <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-2 px-2 shadow-[var(--edge-highlight)]">
                <div role="tablist" aria-label="Document panel" className="flex gap-1 rounded-lg bg-sunken p-1">
                    {tabs.map(item => (
                        <button
                            key={item.id}
                            role="tab"
                            aria-selected={tab === item.id}
                            onClick={() => onTabChange(item.id)}
                            className={cn(
                                'flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors duration-state',
                                tab === item.id ? 'bg-surface-2 text-accent shadow-elev-1' : 'text-text-soft hover:text-text',
                            )}
                        >
                            {item.icon}{item.label}
                            {item.id === 'notes' && noteCount > 0 && <span className="rounded-full bg-accent-soft px-1.5 text-[10px] text-accent">{noteCount}</span>}
                        </button>
                    ))}
                </div>
                <IconButton size="sm" aria-label="Close panel" onClick={onClose}><X size={15} /></IconButton>
            </header>
            <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
                {tab === 'notes' ? notes : tab === 'outline' ? outline : knowledge}
            </div>
        </aside>
    );
}
