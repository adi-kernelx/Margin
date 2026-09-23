import { Plus, X, Settings as SettingsIcon, Sparkles, RotateCw } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { SettingsModal } from './SettingsModal';

import { useState, useCallback } from 'react';
import type { DocumentEntry } from '@/types';
import { cn } from '@/lib/utils';
import { SearchBar, type SearchResult } from './SearchBar';
import { WORKSPACE_TAB_MIME } from '@/core/workspace/layout';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { useUiStore } from '@/lib/ui/ui-store';
import { revealInDocument } from '@/lib/ui/navigate';

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

export function Header({ onOpenPDF, documents, onRemoveDocument, onRefreshDocument, onLoadJSON, showAIChat, onToggleAIChat, onFocusDocument, onShowLibrary }: HeaderProps) {
    const { focusedDocId } = useAppStore();
    const showSettings = useUiStore(state => state.settingsOpen);
    const openSettings = useUiStore(state => state.openSettings);
    const closeSettings = useUiStore(state => state.closeSettings);


    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; docId: string } | null>(null);

    const handleContextMenu = (e: React.MouseEvent, docId: string) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, docId });
    };

    const closeContextMenu = () => setContextMenu(null);

    const handleSearchSelect = useCallback((result: SearchResult) => {
        revealInDocument(result, documents, onFocusDocument);
    }, [documents, onFocusDocument]);

    // Handle focusing a different document from search
    const handleFocusDocument = useCallback((docId: string) => {
        onFocusDocument(docId);
    }, [onFocusDocument]);

    return (
        <header className={cn(
            "h-12 flex items-center justify-between px-4 border-b border-line bg-surface-2 text-text shadow-elev-1 flex-shrink-0 z-40 gap-4"
        )} onClick={closeContextMenu}>
            <div className="flex items-center gap-4 flex-shrink-0">

                <button type="button" className="font-bold text-lg text-accent" onClick={onShowLibrary} title="Open library">Margin</button>
            </div>

            {/* Document Tabs */}
            <div className="flex-1 flex items-center gap-2 overflow-x-auto scrollbar-hide px-2">
                {documents.map((doc) => (
                    <div
                        key={doc.id}
                        draggable
                        role="tab"
                        tabIndex={0}
                        aria-selected={doc.id === focusedDocId}
                        className={cn(
                            // Physical tabs: the active tab is raised and
                            // reads as continuous with the pane below it —
                            // shared fill, lit top edge, no bottom border —
                            // and inactive tabs sit slightly sunken.
                            "group relative flex max-w-[200px] flex-shrink-0 cursor-pointer select-none items-center gap-2",
                            "rounded-t-md border border-b-0 px-3 py-1.5 text-sm transition-all duration-state",
                            "-mb-px",
                            doc.id === focusedDocId
                                ? "z-10 border-line bg-surface-1 text-text shadow-[var(--edge-highlight)]"
                                : "border-transparent bg-sunken text-text-muted hover:bg-surface-2 hover:text-text"
                        )}
                        onClick={() => onFocusDocument(doc.id)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') onFocusDocument(doc.id);
                        }}
                        onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData(WORKSPACE_TAB_MIME, doc.id);
                        }}
                        onContextMenu={(e) => handleContextMenu(e, doc.id)}
                        title={`${doc.name}\nRight-click for options`}
                    >
                        <span className="truncate flex-1">{doc.name}</span>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onRefreshDocument(doc.id);
                            }}
                            className={cn(
                                "p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity",
                                "text-text-muted hover:bg-surface-3 hover:text-accent"
                            )}
                            title="Refresh from disk"
                        >
                            <RotateCw size={12} />
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onRemoveDocument(doc.id);
                            }}
                            className={cn(
                                "p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity",
                                "text-text-muted hover:bg-danger-soft hover:text-danger"
                            )}
                        >
                            <X size={12} />
                        </button>
                    </div>
                ))}
            </div>


            <div className="flex items-center gap-2 flex-shrink-0">
                {/* Expandable Search Bar - Left of Open */}
                <SearchBar
                    currentDocId={focusedDocId}
                    currentDocName={documents.find(d => d.id === focusedDocId)?.name}
                    currentFingerprint={documents.find(d => d.id === focusedDocId)?.pdfFingerprint}
                    openDocIds={documents.map(d => d.id)}
                    documentNames={Object.fromEntries(documents.map(d => [d.id, d.name]))}
                    documentFingerprints={Object.fromEntries(
                        documents.filter(d => d.pdfFingerprint).map(d => [d.id, d.pdfFingerprint!])
                    )}
                    documents={documents.map(d => ({ id: d.id, name: d.name, fingerprint: d.pdfFingerprint }))}
                    onSelect={handleSearchSelect}
                    onFocusDocument={handleFocusDocument}
                    compact={true}
                />

                {/* AI Assistant Button */}
                <IconButton
                    onClick={onToggleAIChat}
                    pressed={showAIChat}
                    aria-label="Toggle AI assistant"
                    title="Assistant (Ctrl+J)"
                >
                    <Sparkles size={18} />
                </IconButton>


                <Button
                    onClick={onOpenPDF}
                    variant="primary"
                    size="sm"
                    leadingIcon={<Plus size={16} />}
                >
                    <span className="hidden sm:inline">Open &amp; add</span>
                </Button>

                <div className="h-4 w-px bg-line mx-1" />

                <IconButton
                    onClick={() => openSettings()}
                    aria-label="Open settings"
                    title="Settings (Ctrl+,)"
                >
                    <SettingsIcon size={18} />
                </IconButton>
            </div>

            <SettingsModal isOpen={showSettings} onClose={closeSettings} />

            {/* Context Menu */}
            {contextMenu && (
                <div
                    role="menu"
                    className={cn(
                        'fixed z-popover w-48 rounded-lg border border-line bg-surface-3 py-1',
                        'shadow-elev-3 text-sm',
                    )}
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        role="menuitem"
                        className="w-full px-4 py-2 text-left text-text-soft hover:bg-sunken hover:text-text"
                        onClick={() => {
                            onRefreshDocument(contextMenu.docId);
                            closeContextMenu();
                        }}
                    >
                        Refresh from disk
                    </button>
                    <button
                        role="menuitem"
                        className="w-full px-4 py-2 text-left text-text-soft hover:bg-sunken hover:text-text"
                        onClick={() => {
                            onLoadJSON(contextMenu.docId);
                            closeContextMenu();
                        }}
                    >
                        Load annotations (JSON)
                    </button>
                </div>
            )}

            {/* Context Menu Backdrop */}
            {contextMenu && (
                <div className="fixed inset-0 z-40" onClick={closeContextMenu} />
            )}


        </header>
    );
}
