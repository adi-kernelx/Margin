import { useRef } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { FileText, Plus, X } from 'lucide-react';
import type { DocumentEntry } from '@/types';
import { WORKSPACE_TAB_MIME } from '@/core/workspace/layout';
import { useSaveStore } from '@/lib/saving/save-manager';
import { cn } from '@/lib/utils';
import { Tooltip } from './ui/Tooltip';

interface DocumentTabsProps {
    documents: DocumentEntry[];
    focusedDocId: string | null;
    onFocus: (docId: string) => void;
    onClose: (docId: string) => void;
    onOpen: () => void;
    onContextMenu: (docId: string, x: number, y: number) => void;
}

/** "paper.pdf" → "paper": the extension is noise on every tab. */
function displayName(name: string) {
    return name.replace(/\.pdf$/i, '');
}

/**
 * The open-document strip. Tabs are physical: the active one is lifted,
 * shares the workspace's surface and has no bottom edge, so it reads as the
 * front sheet the pane below belongs to. Inactive tabs sit back on the strip.
 */
export function DocumentTabs({ documents, focusedDocId, onFocus, onClose, onOpen, onContextMenu }: DocumentTabsProps) {
    const dirtyById = useSaveStore(state => state.isDirtyByPdf);
    const listRef = useRef<HTMLDivElement>(null);

    // Roving focus: arrows move between tabs, Home/End jump, Delete closes.
    const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
        const tabs = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
        let next: number | null = null;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onFocus(documents[index].id);
            return;
        } else if (event.key === 'Delete') {
            event.preventDefault();
            onClose(documents[index].id);
            return;
        }
        if (next === null) return;
        event.preventDefault();
        tabs[next]?.focus();
        onFocus(documents[next].id);
    };

    return (
        <div className="relative flex h-10 items-end gap-2 bg-surface-2 px-3 before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-line">
            <div
                ref={listRef}
                role="tablist"
                aria-label="Open documents"
                className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto scrollbar-hide"
            >
                {documents.length === 0 && (
                    <div className="flex h-9 items-center gap-2 px-1 text-xs text-text-muted">
                        <FileText size={14} aria-hidden />
                        No documents open — open a PDF or pick one from the library
                    </div>
                )}
                {documents.map((document, index) => {
                    const active = document.id === focusedDocId;
                    const dirty = Boolean(dirtyById[document.id]);
                    const name = displayName(document.name);
                    return (
                        <div
                            key={document.id}
                            draggable
                            role="tab"
                            tabIndex={active || (!focusedDocId && index === 0) ? 0 : -1}
                            aria-selected={active}
                            title={`${document.name}${dirty ? ' — unsaved changes' : ''}\nMiddle-click to close · right-click for options`}
                            onClick={() => onFocus(document.id)}
                            onAuxClick={(event: MouseEvent) => {
                                if (event.button === 1) {
                                    event.preventDefault();
                                    onClose(document.id);
                                }
                            }}
                            onKeyDown={event => onTabKeyDown(event, index)}
                            onDragStart={event => {
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData(WORKSPACE_TAB_MIME, document.id);
                            }}
                            onContextMenu={event => {
                                event.preventDefault();
                                onContextMenu(document.id, event.clientX, event.clientY);
                            }}
                            className={cn(
                                'group relative flex h-8 min-w-[120px] max-w-[220px] shrink-0 cursor-pointer select-none items-center gap-2 rounded-t-lg pl-3 pr-1.5 text-[13px] outline-none',
                                'transition-colors duration-state focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                                active
                                    ? [
                                        // Lifted sheet: workspace surface, side and top edges,
                                        // a lit top rim, and it covers the strip's bottom line.
                                        'z-10 -mb-px h-9 border border-b-0 border-line bg-surface-1 font-medium text-text',
                                        'shadow-[inset_0_2px_0_var(--accent)]',
                                    ]
                                    : 'mb-0.5 text-text-muted hover:bg-surface-3 hover:text-text',
                            )}
                        >
                            <FileText size={14} aria-hidden className={cn('shrink-0', active ? 'text-accent' : 'opacity-70')} />
                            <span className="min-w-0 flex-1 truncate">{name}</span>
                            <span className="relative grid size-5 shrink-0 place-items-center">
                                {dirty && (
                                    // The unsaved dot gives way to the close button on
                                    // hover and focus, like an editor tab.
                                    <span
                                        aria-hidden
                                        className="size-2 rounded-full bg-warning transition-opacity duration-state group-hover:opacity-0 group-focus-within:opacity-0"
                                    />
                                )}
                                <button
                                    type="button"
                                    tabIndex={-1}
                                    onClick={event => {
                                        event.stopPropagation();
                                        onClose(document.id);
                                    }}
                                    className={cn(
                                        'absolute inset-0 grid place-items-center rounded text-text-muted transition-opacity duration-state hover:bg-danger-soft hover:text-danger',
                                        dirty || !active ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100' : 'opacity-100',
                                    )}
                                    aria-label={`Close ${document.name}`}
                                >
                                    <X size={13} />
                                </button>
                            </span>
                            {dirty && <span className="sr-only">(unsaved changes)</span>}
                        </div>
                    );
                })}
                <Tooltip side="bottom" content="Open PDF" shortcut="Mod+O">
                    <button
                        type="button"
                        onClick={onOpen}
                        aria-label="Open PDF"
                        className="mb-1 ml-1 grid size-7 shrink-0 place-items-center rounded-md text-text-muted transition-colors duration-state hover:bg-surface-3 hover:text-text"
                    >
                        <Plus size={15} />
                    </button>
                </Tooltip>
            </div>
            {documents.length > 1 && (
                <span className="mb-2.5 hidden shrink-0 text-[11px] font-medium tabular-nums text-text-muted lg:block">
                    {documents.length} open
                </span>
            )}
        </div>
    );
}
