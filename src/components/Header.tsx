import { useCallback, useState } from 'react';
import { FileJson, Plus, RotateCw, Settings as SettingsIcon, Sparkles, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DocumentEntry } from '@/types';
import { ASSISTANT_ENABLED } from '@/lib/features';
import { revealInDocument } from '@/lib/ui/navigate';
import { useUiStore } from '@/lib/ui/ui-store';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button } from './ui/Button';
import { Tooltip } from './ui/Tooltip';
import { DocumentTabs } from './DocumentTabs';
import { SearchBar, type SearchResult } from './SearchBar';
import { SettingsModal } from './SettingsModal';

interface HeaderProps {
    onOpenPDF: () => void;
    documents: DocumentEntry[];
    onRemoveDocument: (id: string) => void;
    onRefreshDocument: (id: string) => void;
    onLoadJSON: (docId: string) => void;
    showAIChat: boolean;
    onToggleAIChat: () => void;
    onFocusDocument: (docId: string) => void;
    onShowLibrary: () => void;
}

/** Brand mark: a page with a ruled margin — the product's name, drawn. */
function MarginMark() {
    return (
        <span
            aria-hidden
            className="relative grid size-8 shrink-0 place-items-center rounded-lg bg-[linear-gradient(145deg,var(--accent),var(--accent-hover))] text-text-onaccent shadow-[var(--elev-1),inset_0_1px_0_rgb(255_255_255/.25)]"
        >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="3.5" y="2" width="11" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="M6.5 2v14" stroke="currentColor" strokeWidth="1.6" opacity=".55" />
                <path d="M9 6h3.5M9 9h3.5M9 12h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
        </span>
    );
}

function HeaderIconButton({ label, shortcut, active, onClick, children }: {
    label: string;
    shortcut?: string;
    active?: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <Tooltip side="bottom" content={label} shortcut={shortcut}>
            <button
                type="button"
                onClick={onClick}
                aria-label={label}
                aria-pressed={active}
                className={cn(
                    'grid size-8 place-items-center rounded-lg transition-colors duration-state',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                    active ? 'bg-accent-soft text-accent' : 'text-text-soft hover:bg-surface-3 hover:text-text',
                )}
            >
                {children}
            </button>
        </Tooltip>
    );
}

export function Header({
    onOpenPDF,
    documents,
    onRemoveDocument,
    onRefreshDocument,
    onLoadJSON,
    showAIChat,
    onToggleAIChat,
    onFocusDocument,
    onShowLibrary,
}: HeaderProps) {
    const focusedDocId = useAppStore(state => state.focusedDocId);
    const showSettings = useUiStore(state => state.settingsOpen);
    const openSettings = useUiStore(state => state.openSettings);
    const closeSettings = useUiStore(state => state.closeSettings);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; docId: string } | null>(null);

    const handleSearchSelect = useCallback((result: SearchResult) => {
        revealInDocument(result, documents, onFocusDocument, { persistHighlight: true });
    }, [documents, onFocusDocument]);

    const closeContextMenu = () => setContextMenu(null);

    const menuItem = (label: string, icon: ReactNode, action: () => void, danger = false) => (
        <button
            role="menuitem"
            className={cn(
                'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors duration-state',
                danger ? 'text-danger hover:bg-danger-soft' : 'text-text-soft hover:bg-sunken hover:text-text',
            )}
            onClick={() => {
                action();
                closeContextMenu();
            }}
        >
            {icon}
            {label}
        </button>
    );

    return (
        <header className="relative z-40 flex-shrink-0 bg-surface-2 text-text">
            <div className="flex h-12 items-center gap-3 px-3">
                <Tooltip side="bottom" content="Library">
                    <button
                        type="button"
                        onClick={onShowLibrary}
                        aria-label="Margin — open library"
                        className="group flex shrink-0 items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 transition-colors duration-state hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                        <MarginMark />
                        <span className="hidden text-[15px] font-bold tracking-tight sm:block">Margin</span>
                    </button>
                </Tooltip>

                <div className="mx-auto w-full min-w-0 max-w-[640px]">
                    <SearchBar
                        currentDocId={focusedDocId}
                        onSelect={handleSearchSelect}
                    />
                </div>

                <div className="flex shrink-0 items-center gap-1">
                    {ASSISTANT_ENABLED && (
                        <HeaderIconButton label="Assistant" shortcut="Mod+J" active={showAIChat} onClick={onToggleAIChat}>
                            <Sparkles size={17} />
                        </HeaderIconButton>
                    )}
                    <HeaderIconButton label="Settings" shortcut="Mod+," onClick={() => openSettings()}>
                        <SettingsIcon size={17} />
                    </HeaderIconButton>
                    <span aria-hidden className="mx-1.5 h-5 w-px bg-line" />
                    <Tooltip side="bottom" content="Open PDF" shortcut="Mod+O">
                        <Button
                            onClick={onOpenPDF}
                            variant="primary"
                            size="sm"
                            leadingIcon={<Plus size={15} strokeWidth={2.5} />}
                            className="h-8 rounded-lg px-3 shadow-[var(--elev-1),inset_0_1px_0_rgb(255_255_255/.18)]"
                            aria-label="Open PDF"
                        >
                            <span className="hidden md:inline">Open PDF</span>
                        </Button>
                    </Tooltip>
                </div>
            </div>

            <DocumentTabs
                documents={documents}
                focusedDocId={focusedDocId}
                onFocus={onFocusDocument}
                onClose={onRemoveDocument}
                onOpen={onOpenPDF}
                onContextMenu={(docId, x, y) => setContextMenu({ docId, x, y })}
            />

            <SettingsModal isOpen={showSettings} onClose={closeSettings} />

            {contextMenu && (
                <>
                    <div className="fixed inset-0 z-40" onClick={closeContextMenu} onContextMenu={event => { event.preventDefault(); closeContextMenu(); }} />
                    <div
                        role="menu"
                        className="fixed z-popover w-56 rounded-lg border border-line bg-surface-3 py-1 shadow-elev-3 animate-[dialog-in_var(--dur-state)_var(--ease)]"
                        style={{ top: contextMenu.y, left: Math.min(contextMenu.x, window.innerWidth - 232) }}
                        onKeyDown={event => { if (event.key === 'Escape') closeContextMenu(); }}
                    >
                        {menuItem('Refresh from disk', <RotateCw size={14} />, () => onRefreshDocument(contextMenu.docId))}
                        {menuItem('Load annotations (JSON)…', <FileJson size={14} />, () => onLoadJSON(contextMenu.docId))}
                        <div className="my-1 h-px bg-line-soft" />
                        {menuItem('Close', <X size={14} />, () => onRemoveDocument(contextMenu.docId))}
                        {documents.length > 1 && menuItem('Close others', <X size={14} />, () => {
                            documents.filter(document => document.id !== contextMenu.docId).forEach(document => onRemoveDocument(document.id));
                        })}
                    </div>
                </>
            )}
        </header>
    );
}
