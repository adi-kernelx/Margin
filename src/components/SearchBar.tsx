import { useState, useCallback, useRef, useEffect } from "react";
import { Search, ChevronDown, FileText, Files } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";
import { localSearchRegistry } from "@/lib/search/local-search";
import type { SearchSpan, SearchResult } from "@/lib/search/local-search";
export type { SearchSpan, SearchResult };

export type SearchHighlight = {
    docId: string;
    page: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    spans?: SearchSpan[];
};

type SearchScope = "current" | "all" | string;  // string = specific docId

interface DocumentInfo {
    id: string;
    name: string;
    fingerprint?: string;  // PDF fingerprint for search
}

interface SearchBarProps {
    currentDocId?: string | null;
    currentDocName?: string;  // Display name of current PDF
    currentFingerprint?: string | null;  // PDF fingerprint for current doc
    openDocIds?: string[];
    documentNames?: Record<string, string>;  // Map of docId -> display name
    documentFingerprints?: Record<string, string>;  // Map of docId -> fingerprint
    documents?: DocumentInfo[];  // Full document list for individual selection
    onSelect: (result: SearchResult) => void;
    onFocusDocument?: (docId: string) => void;
    compact?: boolean;
}

export function SearchBar({
    currentDocId,
    currentDocName,
    currentFingerprint,
    openDocIds = [],
    documentNames = {},
    documentFingerprints = {},
    documents = [],
    onSelect,
    onFocusDocument,
    compact = false
}: SearchBarProps) {
    const { isDarkMode } = useAppStore();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);  // For expandable mode
    const [error, setError] = useState<string | null>(null);
    const [scope, setScope] = useState<SearchScope>("current");
    const [lockedFingerprint, setLockedFingerprint] = useState<string | null>(null);  // Locked when scope selected
    const [showScopeMenu, setShowScopeMenu] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Lock fingerprint when scope is set to a specific document
    const handleScopeChange = (newScope: SearchScope) => {
        setScope(newScope);
        if (newScope === "current") {
            setLockedFingerprint(currentFingerprint || null);
        } else if (newScope === "all") {
            setLockedFingerprint(null);
        } else {
            // Specific docId selected
            setLockedFingerprint(documentFingerprints[newScope] || null);
        }
        setShowScopeMenu(false);
    };

    // Initialize locked fingerprint when search bar expands
    const handleExpand = () => {
        setIsExpanded(true);
        // Lock to current document's fingerprint
        setLockedFingerprint(currentFingerprint || null);
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setShowScopeMenu(false);
                if (compact && !query.trim()) {
                    setIsExpanded(false);
                }
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [compact, query]);

    const runSearch = useCallback(async () => {
        if (!query.trim()) return;

        setIsLoading(true);
        setError(null);

        console.log('[SearchBar] Search:', query.trim(), 'Scope:', scope);

        try {
            // Use lockedFingerprint (set when scope was selected) - not affected by hover
            let searchFingerprint: string | null = lockedFingerprint;
            let searchDocId: string | null = null;  // Keep for result matching

            console.log('[SearchBar] Scope resolution:', {
                scope,
                lockedFingerprint,
                currentDocId,
                currentFingerprint,
                documentFingerprints,
                availableDocIds: Object.keys(documentFingerprints)
            });

            // lockedFingerprint is already the correct fingerprint (set when scope was selected)
            // No need to look up again - this prevents hover from affecting search
            if (scope !== "all" && !searchFingerprint) {
                // If fingerprint wasn't locked, try to get it now (fallback)
                if (scope === "current") {
                    searchFingerprint = currentFingerprint || null;
                    searchDocId = currentDocId || null;
                } else {
                    searchFingerprint = documentFingerprints[scope] || null;
                    searchDocId = scope;
                }
            }

            console.log('[SearchBar] Resolved:', { searchFingerprint, searchDocId });

            // Build array of scope identifiers (either docIds or fingerprints)
            const scopeIds: string[] = [];
            if (scope === "all") {
                // If "all", leave scopeIds empty to search everything registered
            } else if (searchFingerprint) {
                scopeIds.push(searchFingerprint);
            } else if (searchDocId) {
                scopeIds.push(searchDocId);
            }

            console.log('[SearchBar] Calling local search with scopeIds:', scopeIds);
            
            // Execute local search
            let searchResults = await localSearchRegistry.search(query.trim(), scopeIds);
            console.log('[SearchBar] Raw results:', searchResults.length);

            // Filter to only open documents when searching "All open PDFs"
            if (scope === "all" && openDocIds.length > 0) {
                searchResults = searchResults.filter((r: SearchResult) =>
                    openDocIds.includes(r.docId)
                );
                console.log('[SearchBar] Filtered to open docs:', searchResults.length);
            }

            setResults(searchResults.slice(0, 50)); // Limit to 50 results
            setIsOpen(true);
        } catch (err) {
            console.error("[SearchBar] Search error:", err);
            setError("Search failed. Please try again.");
            setResults([]);
        } finally {
            setIsLoading(false);
        }
    }, [query, scope, currentDocId, currentFingerprint, documentFingerprints, openDocIds]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            runSearch();
        }
        if (e.key === "Escape") {
            setIsOpen(false);
            setShowScopeMenu(false);
        }
    };

    const handleSelect = (result: SearchResult) => {
        // If result is from a different document, focus it first
        if (result.docId !== currentDocId && onFocusDocument) {
            onFocusDocument(result.docId);
        }
        onSelect(result);
        setIsOpen(false);
    };

    // Group results by document for "all" scope
    const groupedResults = scope === "all"
        ? results.reduce((acc, r) => {
            if (!acc[r.docId]) acc[r.docId] = [];
            acc[r.docId].push(r);
            return acc;
        }, {} as Record<string, SearchResult[]>)
        : null;

    // Helper to get display name for a docId
    const getDocName = (docId: string) => {
        return documentNames[docId] || docId.slice(0, 12) + '...';
    };

    // Truncate long names for display
    const truncateName = (name: string, maxLen: number = 20) => {
        if (name.length <= maxLen) return name;
        return name.slice(0, maxLen - 3) + '...';
    };

    // Scope label shows actual PDF name or "All PDFs"
    const getScopeLabel = () => {
        if (scope === "current") {
            // If we have a locked fingerprint, show that document's name
            // This ensures UI matches the actual search scope behavior
            if (lockedFingerprint) {
                const lockedDoc = documents.find(d => d.fingerprint === lockedFingerprint);
                if (lockedDoc) return truncateName(lockedDoc.name, 12);
            }
            return currentDocName ? truncateName(currentDocName, 12) : "Current";
        } else if (scope === "all") {
            return "All PDFs";
        } else {
            // Specific docId
            const name = documentNames[scope] || documents.find(d => d.id === scope)?.name;
            return name ? truncateName(name, 12) : "PDF";
        }
    };
    const ScopeIcon = scope === "all" ? Files : FileText;

    // In compact mode, show only icon when collapsed
    if (compact && !isExpanded) {
        return (
            <div ref={containerRef} className="relative">
                <button
                    onClick={handleExpand}
                    className={cn(
                        "p-2 rounded-md transition-colors",
                        isDarkMode
                            ? "text-gray-400 hover:text-blue-300 hover:bg-gray-800"
                            : "text-gray-500 hover:text-blue-600 hover:bg-gray-100"
                    )}
                    title="Search PDFs"
                >
                    <Search size={18} />
                </button>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="relative" style={{ minWidth: compact ? 240 : 280 }}>
            {/* Search Input Row */}
            <div className="flex items-center gap-1">
                {/* Scope Selector */}
                <div className="relative">
                    <button
                        onClick={() => setShowScopeMenu(!showScopeMenu)}
                        className={cn(
                            "flex items-center gap-1 px-2 py-1.5 rounded-l-lg border-r-0 text-xs font-medium transition-colors",
                            isDarkMode
                                ? "bg-gray-700 border border-gray-600 text-gray-300 hover:bg-gray-600"
                                : "bg-gray-100 border border-gray-300 text-gray-600 hover:bg-gray-200"
                        )}
                        title="Search scope"
                    >
                        <ScopeIcon size={14} />
                        <span className="hidden sm:inline max-w-[80px] truncate">{getScopeLabel()}</span>
                        <ChevronDown size={12} />
                    </button>

                    {/* Scope Dropdown with Individual PDFs */}
                    {showScopeMenu && (
                        <div className={cn(
                            "absolute top-full left-0 mt-1 w-52 max-h-64 overflow-y-auto rounded-lg shadow-lg border z-50",
                            isDarkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
                        )}>
                            {/* All PDFs option */}
                            <button
                                onClick={() => handleScopeChange("all")}
                                disabled={openDocIds.length === 0}
                                className={cn(
                                    "w-full flex items-center gap-2 px-3 py-2 text-sm text-left border-b transition-colors",
                                    scope === "all"
                                        ? (isDarkMode ? "bg-blue-900/30 text-blue-400" : "bg-blue-50 text-blue-600")
                                        : (isDarkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700"),
                                    isDarkMode ? "border-gray-700" : "border-gray-200",
                                    openDocIds.length === 0 && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                <Files size={14} />
                                <span>All open PDFs</span>
                                {openDocIds.length > 0 && (
                                    <span className="ml-auto text-xs opacity-60">({openDocIds.length})</span>
                                )}
                            </button>

                            {/* Divider label */}
                            {documents.length > 0 && (
                                <div className={cn(
                                    "px-3 py-1.5 text-xs font-semibold uppercase tracking-wide",
                                    isDarkMode ? "text-gray-500 bg-gray-900" : "text-gray-400 bg-gray-50"
                                )}>
                                    Individual PDFs
                                </div>
                            )}

                            {/* Individual PDF options */}
                            {documents.map((doc, idx) => (
                                <button
                                    key={doc.id}
                                    onClick={() => handleScopeChange(doc.id)}
                                    className={cn(
                                        "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
                                        scope === doc.id
                                            ? (isDarkMode ? "bg-blue-900/30 text-blue-400" : "bg-blue-50 text-blue-600")
                                            : (isDarkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700"),
                                        idx === documents.length - 1 && "rounded-b-lg"
                                    )}
                                >
                                    <FileText size={14} className="flex-shrink-0" />
                                    <span className="truncate" title={doc.name}>
                                        {truncateName(doc.name, 25)}
                                    </span>
                                    {doc.id === currentDocId && (
                                        <span className={cn(
                                            "ml-auto text-xs px-1.5 py-0.5 rounded",
                                            isDarkMode ? "bg-gray-700 text-gray-400" : "bg-gray-200 text-gray-500"
                                        )}>current</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Search Input */}
                <div className="relative flex-1">
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={() => results.length > 0 && setIsOpen(true)}
                        placeholder="Search document..."
                        className={cn(
                            "w-full px-3 py-1.5 pl-8 text-sm border-y focus:outline-none focus:ring-2 focus:ring-blue-500",
                            isDarkMode
                                ? "bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500"
                                : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"
                        )}
                    />
                    <Search
                        size={14}
                        className={cn(
                            "absolute left-2.5 top-1/2 -translate-y-1/2",
                            isDarkMode ? "text-gray-500" : "text-gray-400"
                        )}
                    />
                </div>

                {/* Search Button */}
                <button
                    onClick={runSearch}
                    disabled={isLoading || !query.trim()}
                    className={cn(
                        "px-3 py-1.5 text-sm font-medium rounded-r-lg transition-colors",
                        "bg-blue-600 text-white hover:bg-blue-700",
                        "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                >
                    {isLoading ? "..." : compact ? <Search size={14} /> : "Search"}
                </button>
            </div>

            {/* Error Message */}
            {error && (
                <div className={cn(
                    "absolute top-full left-0 right-0 mt-1 p-2 text-xs rounded-lg border z-50",
                    isDarkMode
                        ? "bg-red-900/20 border-red-800 text-red-400"
                        : "bg-red-50 border-red-200 text-red-600"
                )}>
                    {error}
                </div>
            )}

            {/* Results Dropdown */}
            {isOpen && results.length > 0 && (
                <div className={cn(
                    "absolute top-full left-0 right-0 mt-1 max-h-96 overflow-y-auto rounded-lg shadow-xl border z-50",
                    isDarkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
                )}>
                    {scope === "all" && groupedResults ? (
                        // Grouped view for multi-doc search
                        Object.entries(groupedResults).map(([docId, docResults]) => (
                            <div key={docId}>
                                {/* Document Header - Show PDF name */}
                                <div className={cn(
                                    "px-3 py-2 text-xs font-semibold uppercase tracking-wide border-b sticky top-0",
                                    isDarkMode
                                        ? "bg-gray-900 border-gray-700 text-gray-400"
                                        : "bg-gray-50 border-gray-200 text-gray-500"
                                )}>
                                    <div className="flex items-center gap-2">
                                        <FileText size={12} />
                                        <span className="truncate" title={getDocName(docId)}>
                                            {getDocName(docId)}
                                        </span>
                                        <span className="ml-auto flex-shrink-0">{docResults.length} results</span>
                                    </div>
                                </div>
                                {/* Results for this document - show page numbers */}
                                {docResults.map((r, i) => (
                                    <ResultItem
                                        key={`${docId}-${i}`}
                                        result={r}
                                        onClick={() => handleSelect(r)}
                                        isDarkMode={isDarkMode}
                                        docName={getDocName(r.docId)}
                                    />
                                ))}
                            </div>
                        ))
                    ) : (
                        // Flat view for single-doc search - show page numbers
                        results.map((r, i) => {
                            // Resolve the correct document name for this result
                            // 1. Try to find by fingerprint (robust)
                            let resultDocName = "";
                            if (r.pdfFingerprint) {
                                const match = documents.find(d => d.fingerprint === r.pdfFingerprint);
                                if (match) resultDocName = match.name;
                            }

                            // 2. Fallback to locked document name if we are in a locked scope
                            if (!resultDocName && lockedFingerprint) {
                                const lockedDoc = documents.find(d => d.fingerprint === lockedFingerprint);
                                if (lockedDoc) resultDocName = lockedDoc.name;
                            }

                            // 3. Fallback to currentDocName (but this is unstable with hover, so use as last resort)
                            if (!resultDocName) {
                                resultDocName = currentDocName || "Unknown PDF";
                            }

                            return (
                                <ResultItem
                                    key={i}
                                    result={r}
                                    onClick={() => handleSelect(r)}
                                    isDarkMode={isDarkMode}
                                    docName={resultDocName}
                                />
                            );
                        })
                    )}
                </div>
            )}

            {/* No Results */}
            {isOpen && results.length === 0 && !error && !isLoading && query.trim() && (
                <div className={cn(
                    "absolute top-full left-0 right-0 mt-1 p-4 text-sm text-center rounded-lg shadow-lg border z-50",
                    isDarkMode
                        ? "bg-gray-800 border-gray-700 text-gray-400"
                        : "bg-white border-gray-200 text-gray-500"
                )}>
                    No results found for "{query}"
                </div>
            )}
        </div>
    );
}

// Result Item Component
function ResultItem({
    result,
    onClick,
    isDarkMode,
    docName
}: {
    result: SearchResult;
    onClick: () => void;
    isDarkMode: boolean;
    docName?: string;  // Display name of the PDF
}) {
    return (
        <div
            onClick={onClick}
            className={cn(
                "p-3 border-b last:border-b-0 cursor-pointer transition-colors",
                isDarkMode
                    ? "border-gray-700 hover:bg-gray-700"
                    : "border-gray-100 hover:bg-gray-50"
            )}
        >
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 flex-wrap">
                    {/* PDF Name Tag */}
                    {docName && (
                        <span className={cn(
                            "text-xs font-medium px-1.5 py-0.5 rounded truncate max-w-[120px]",
                            isDarkMode ? "bg-gray-700 text-gray-300" : "bg-gray-200 text-gray-600"
                        )} title={docName}>
                            {docName.length > 18 ? docName.slice(0, 15) + '...' : docName}
                        </span>
                    )}
                    {/* Page Number Tag */}
                    <span className={cn(
                        "text-xs font-medium px-1.5 py-0.5 rounded",
                        isDarkMode ? "bg-blue-900/50 text-blue-300" : "bg-blue-100 text-blue-700"
                    )}>
                        Page {result.page}
                    </span>
                </div>
                <span className={cn(
                    "text-xs flex-shrink-0",
                    result.score > 0.7
                        ? "text-green-500"
                        : result.score > 0.5
                            ? "text-yellow-500"
                            : "text-gray-400"
                )}>
                    {(result.score * 100).toFixed(0)}%
                </span>
            </div>
            {/* Shorter text preview - single line */}
            <p className={cn(
                "text-xs line-clamp-1",
                isDarkMode ? "text-gray-400" : "text-gray-500"
            )}>
                {result.text.slice(0, 80)}{result.text.length > 80 ? "..." : ""}
            </p>
        </div>
    );
}
