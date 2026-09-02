import { Plus, X, Settings as SettingsIcon, LogOut, User as UserIcon, Sparkles, RotateCw } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { useAppStore } from '@/lib/store';
import { SettingsModal } from './SettingsModal';

import { useState, useCallback } from 'react';
import type { DocumentEntry } from '@/types';
import { cn } from '@/lib/utils';
import { SearchBar, type SearchResult } from './SearchBar';

interface HeaderProps {
    onOpenPDF: () => void;
    documents: DocumentEntry[];
    onRemoveDocument: (id: string) => void;
    onRefreshDocument: (id: string) => void;

    onLoadJSON: (docId: string) => void;
    showAIChat: boolean;
    onToggleAIChat: () => void;
}

export function Header({ onOpenPDF, documents, onRemoveDocument, onRefreshDocument, onLoadJSON, showAIChat, onToggleAIChat }: HeaderProps) {
    const { isDarkMode, focusedDocId, setFocusedDocId, setSearchHighlight, clearSearchHighlight } = useAppStore();
    const { logout, user } = useAuthStore();
    const [showSettings, setShowSettings] = useState(false);


    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; docId: string } | null>(null);

    const handleSignIn = () => {
        window.location.href = '/login';
    };

    const handleContextMenu = (e: React.MouseEvent, docId: string) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, docId });
    };

    const closeContextMenu = () => setContextMenu(null);

    // Handle search result selection
    const handleSearchSelect = useCallback((result: SearchResult) => {
        console.log('[Header] handleSearchSelect called:', result);

        // Map the result's docId (from Qdrant, possibly stale) to current session's docId
        // using pdfFingerprint for reliable matching
        let targetDocId = result.docId;

        if (result.pdfFingerprint) {
            // Find the current document with matching fingerprint
            const matchingDoc = documents.find(d => d.pdfFingerprint === result.pdfFingerprint);
            if (matchingDoc) {
                targetDocId = matchingDoc.id;
                console.log('[Header] Mapped fingerprint to current docId:', targetDocId);
            } else {
                console.warn('[Header] No open document matches fingerprint:', result.pdfFingerprint);
            }
        }

        // 1. Focus the document if different
        if (targetDocId !== focusedDocId) {
            console.log('[Header] Focusing different document:', targetDocId);
            setFocusedDocId(targetDocId);
        }

        // 2. Set the search highlight with spans if available
        const highlight: any = {
            docId: targetDocId,  // Use mapped docId
            page: result.page,
            bbox: result.bbox
        };

        // Include spans for precise word-level highlighting
        if (result.spans && result.spans.length > 0) {
            highlight.spans = result.spans;
            console.log('[Header] Using span-level highlights:', result.spans.length, 'spans');
        }

        console.log('[Header] Setting search highlight:', highlight);
        setSearchHighlight(highlight);

        // 3. Scroll to the page (using custom event)
        setTimeout(() => {
            // Find the page element within the correct document pane
            const docPane = document.querySelector(`[data-doc-id="${targetDocId}"]`);
            const pageElement = docPane?.querySelector(`[data-page-num="${result.page}"]`)
                || document.querySelector(`[data-page-num="${result.page}"]`);
            console.log('[Header] Scrolling to page element:', pageElement);
            if (pageElement) {
                pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);

        // 4. Clear highlight after 5 seconds
        setTimeout(() => {
            console.log('[Header] Clearing search highlight');
            clearSearchHighlight();
        }, 5000);
    }, [documents, focusedDocId, setFocusedDocId, setSearchHighlight, clearSearchHighlight]);

    // Handle focusing a different document from search
    const handleFocusDocument = useCallback((docId: string) => {
        setFocusedDocId(docId);
    }, [setFocusedDocId]);

    return (
        <header className={cn(
            "h-12 flex items-center justify-between px-4 border-b flex-shrink-0 z-40 gap-4",
            isDarkMode ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200"
        )} onClick={closeContextMenu}>
            <div className="flex items-center gap-4 flex-shrink-0">

                <h1 className="font-bold text-lg text-blue-600 dark:text-blue-400">PDF Reader</h1>
            </div>

            {/* Document Tabs */}
            <div className="flex-1 flex items-center gap-2 overflow-x-auto scrollbar-hide px-2">
                {documents.map((doc) => (
                    <div
                        key={doc.id}
                        className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm max-w-[200px] flex-shrink-0 group select-none cursor-pointer transition-all relative",
                            doc.id === focusedDocId
                                ? "ring-2 ring-blue-500 border-blue-500 z-10"
                                : "hover:border-gray-400",
                            isDarkMode
                                ? "bg-gray-800 border-gray-700 text-gray-200"
                                : "bg-gray-50 border-gray-200 text-gray-700"
                        )}
                        onClick={() => setFocusedDocId(doc.id)}
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
                                isDarkMode ? "hover:bg-gray-700 text-gray-400 hover:text-blue-400" : "hover:bg-gray-200 text-gray-400 hover:text-blue-500"
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
                                isDarkMode ? "hover:bg-gray-700 text-gray-400 hover:text-red-400" : "hover:bg-gray-200 text-gray-400 hover:text-red-500"
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
                <button
                    onClick={onToggleAIChat}
                    className={cn(
                        "p-1.5 rounded-md transition-colors",
                        showAIChat
                            ? "bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300"
                            : "hover:bg-purple-100 dark:hover:bg-purple-900/30 text-purple-600 dark:text-purple-400"
                    )}
                    title="AI Assistant"
                >
                    <Sparkles size={18} />
                </button>


                <button
                    onClick={onOpenPDF}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors shadow-sm"
                    disabled={documents.length >= 4}
                >
                    <Plus size={16} />
                    <span className="hidden sm:inline">Open</span>
                </button>

                <div className="h-4 w-px bg-gray-300 dark:bg-gray-700 mx-1" />

                <button
                    onClick={() => setShowSettings(true)}
                    className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors"
                    title="Settings"
                >
                    <SettingsIcon size={18} />
                </button>
                {user ? (
                    <button
                        onClick={() => logout()}
                        className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors"
                        title="Sign Out"
                    >
                        <LogOut size={18} />
                    </button>
                ) : (
                    <button
                        onClick={handleSignIn}
                        className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors"
                        title="Sign In"
                    >
                        <UserIcon size={18} />
                    </button>
                )}
            </div>

            <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-50 bg-white dark:bg-gray-800 border dark:border-gray-700 shadow-xl rounded-lg py-1 w-48"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                        onClick={() => {
                            onRefreshDocument(contextMenu.docId);
                            closeContextMenu();
                        }}
                    >
                        Refresh from Disk
                    </button>
                    <button
                        className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                        onClick={() => {
                            onLoadJSON(contextMenu.docId);
                            closeContextMenu();
                        }}
                    >
                        Load Annotations (JSON)
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

