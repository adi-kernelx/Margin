import { useState, useCallback, useRef, useEffect, useId, useMemo } from "react";
import { Search, ChevronDown, FileText, Files, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { localSearchRegistry } from "@/lib/search/local-search";
import type { SearchSpan, SearchResult } from "@/lib/search/local-search";
import { resolveSearchScopeIds } from '@/core/search/index';
import { groupBy, highlightSegments, snippetAround } from '@/core/search/snippet';
import { FOCUS_SEARCH_EVENT } from '@/lib/ui/ui-store';
import { IconButton } from './ui/IconButton';
import { EmptyState, ErrorState } from './ui/States';
import { KeyCaps } from './CommandLayer';
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

const RESULT_LIMIT = 50;

function truncateName(name: string, maxLen = 20) {
    return name.length <= maxLen ? name : `${name.slice(0, maxLen - 1)}…`;
}

export function SearchBar({
    currentDocId,
    currentDocName,
    openDocIds = [],
    documentNames = {},
    documents = [],
    onSelect,
    onFocusDocument,
    compact = false
}: SearchBarProps) {
    const [query, setQuery] = useState("");
    const [submittedQuery, setSubmittedQuery] = useState("");
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(!compact);
    const [error, setError] = useState<string | null>(null);
    const [scope, setScope] = useState<SearchScope>("current");
    const [showScopeMenu, setShowScopeMenu] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const listId = useId();

    const expand = useCallback(() => {
        setIsExpanded(true);
        requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        });
    }, []);

    // Ctrl+F (via the command registry) and any other surface can focus search.
    useEffect(() => {
        window.addEventListener(FOCUS_SEARCH_EVENT, expand);
        return () => window.removeEventListener(FOCUS_SEARCH_EVENT, expand);
    }, [expand]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setShowScopeMenu(false);
                if (compact && !query.trim()) setIsExpanded(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [compact, query]);

    const runSearch = useCallback(async () => {
        const trimmed = query.trim();
        if (!trimmed) return;
        setIsLoading(true);
        setError(null);
        setIsOpen(true);
        try {
            // The open-tab id is stable across merge/materialize cycles; a PDF
            // fingerprint is not, so using it here would make current-document
            // search silently lose the document immediately after a merge.
            const scopeIds = resolveSearchScopeIds(scope, currentDocId);
            let searchResults = await localSearchRegistry.search(trimmed, scopeIds);
            if (scope === "all" && openDocIds.length > 0) {
                searchResults = searchResults.filter((r: SearchResult) => openDocIds.includes(r.docId));
            }
            setResults(searchResults.slice(0, RESULT_LIMIT));
            setSubmittedQuery(trimmed);
            setActiveIndex(searchResults.length ? 0 : -1);
        } catch (err) {
            console.error("[SearchBar] Search error:", err);
            setError("The local index could not be read.");
            setResults([]);
        } finally {
            setIsLoading(false);
        }
    }, [query, scope, currentDocId, openDocIds]);

    const resolveDocName = useCallback((result: SearchResult) => {
        if (result.pdfFingerprint) {
            const match = documents.find(d => d.fingerprint === result.pdfFingerprint);
            if (match) return match.name;
        }
        return documentNames[result.docId]
            || documents.find(d => d.id === result.docId)?.name
            || (scope !== 'all' && scope !== 'current' ? documentNames[scope] : undefined)
            || currentDocName
            || 'Document';
    }, [documents, documentNames, scope, currentDocName]);

    // Each result carries its position in visual order, so arrow keys walk
    // the groups top to bottom.
    const groups = useMemo(() => {
        let position = 0;
        return groupBy(results, resolveDocName).map(group => ({
            key: group.key,
            items: group.items.map(result => ({ result, index: position++ })),
        }));
    }, [results, resolveDocName]);
    const flat = useMemo(() => groups.flatMap(group => group.items.map(item => item.result)), [groups]);

    useEffect(() => {
        listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    const handleSelect = (result: SearchResult) => {
        if (result.docId !== currentDocId && onFocusDocument) onFocusDocument(result.docId);
        onSelect(result);
        setIsOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown" && isOpen && flat.length) {
            e.preventDefault();
            setActiveIndex(index => Math.min(flat.length - 1, index + 1));
        } else if (e.key === "ArrowUp" && isOpen && flat.length) {
            e.preventDefault();
            setActiveIndex(index => Math.max(0, index - 1));
        } else if (e.key === "Enter") {
            e.preventDefault();
            // Enter opens the highlighted result when the query hasn't changed
            // since it was run; otherwise it runs the new query.
            if (isOpen && activeIndex >= 0 && flat[activeIndex] && query.trim() === submittedQuery) handleSelect(flat[activeIndex]);
            else void runSearch();
        } else if (e.key === "Escape") {
            e.preventDefault();
            if (isOpen) setIsOpen(false);
            else if (compact) {
                setQuery('');
                setIsExpanded(false);
            }
            setShowScopeMenu(false);
        }
    };

    const scopeLabel = scope === "current"
        ? (currentDocName ? truncateName(currentDocName, 14) : "This document")
        : scope === "all"
            ? "All open"
            : truncateName(documentNames[scope] || documents.find(d => d.id === scope)?.name || "Document", 14);
    const ScopeIcon = scope === "all" ? Files : FileText;

    if (compact && !isExpanded) {
        return (
            <div ref={containerRef} className="relative">
                <IconButton aria-label="Search documents" title="Search (Ctrl+F)" onClick={expand}>
                    <Search size={18} />
                </IconButton>
            </div>
        );
    }

    const scopeItem = (value: SearchScope, label: string, icon: React.ReactNode, extra?: React.ReactNode, disabled = false) => (
        <button
            key={value}
            role="menuitemradio"
            aria-checked={scope === value}
            disabled={disabled}
            onClick={() => { setScope(value); setShowScopeMenu(false); inputRef.current?.focus(); }}
            className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-state disabled:cursor-not-allowed disabled:opacity-50",
                scope === value ? "bg-accent-soft text-accent" : "text-text-soft hover:bg-sunken hover:text-text",
            )}
        >
            {icon}
            <span className="truncate">{label}</span>
            {extra}
        </button>
    );

    return (
        <div ref={containerRef} className="relative" style={{ minWidth: compact ? 260 : 300 }}>
            <div className="flex h-8 items-stretch overflow-hidden rounded border border-line bg-sunken shadow-[var(--edge-press)] focus-within:border-accent">
                <div className="relative flex">
                    <button
                        onClick={() => setShowScopeMenu(!showScopeMenu)}
                        aria-haspopup="menu"
                        aria-expanded={showScopeMenu}
                        className="flex items-center gap-1 border-r border-line bg-surface-2 px-2 text-xs font-medium text-text-soft transition-colors duration-state hover:text-text"
                        title="Search scope"
                    >
                        <ScopeIcon size={13} />
                        <span className="hidden max-w-[90px] truncate sm:inline">{scopeLabel}</span>
                        <ChevronDown size={12} />
                    </button>
                </div>
                <label className="relative flex flex-1 items-center">
                    <span className="sr-only">Search text</span>
                    <Search size={14} className="pointer-events-none absolute left-2 text-text-muted" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={() => results.length > 0 && setIsOpen(true)}
                        placeholder="Search…"
                        role="combobox"
                        aria-expanded={isOpen}
                        aria-controls={listId}
                        aria-activedescendant={isOpen && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
                        className="h-full w-full bg-transparent pl-7 pr-2 text-sm text-text outline-none placeholder:text-text-muted"
                    />
                </label>
                {isLoading
                    ? <span className="grid w-8 place-items-center text-text-muted"><Loader2 size={14} className="animate-spin" /></span>
                    : query && (
                        <button className="grid w-8 place-items-center text-text-muted hover:text-text" aria-label="Clear search" onClick={() => { setQuery(''); setResults([]); setIsOpen(false); inputRef.current?.focus(); }}>
                            <X size={14} />
                        </button>
                    )}
            </div>

            {showScopeMenu && (
                <div role="menu" aria-label="Search scope" className="absolute left-0 top-full z-popover mt-1 max-h-72 w-60 overflow-y-auto rounded-lg border border-line bg-surface-3 py-1 shadow-elev-3">
                    {scopeItem("current", currentDocName ? `This document` : "Current document", <FileText size={14} />)}
                    {scopeItem("all", "All open documents", <Files size={14} />, openDocIds.length > 0 && <span className="ml-auto text-xs text-text-muted">{openDocIds.length}</span>, openDocIds.length === 0)}
                    {documents.length > 0 && <div className="mt-1 border-t border-line-soft px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Individual documents</div>}
                    {documents.map(doc => scopeItem(
                        doc.id,
                        doc.name,
                        <FileText size={14} className="shrink-0" />,
                        doc.id === currentDocId && <span className="ml-auto rounded-sm bg-sunken px-1.5 text-xs text-text-muted">current</span>,
                    ))}
                </div>
            )}

            {isOpen && (
                <div className="absolute right-0 top-full z-popover mt-1 w-[440px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-line bg-surface-3 shadow-elev-3 animate-[dialog-in_var(--dur-surface)_var(--ease)]">
                    {error ? (
                        <ErrorState title="Search failed" description={error} onRetry={() => void runSearch()} />
                    ) : isLoading && !results.length ? (
                        <div className="space-y-3 p-4" aria-busy="true">
                            {[0, 1, 2].map(row => <div key={row} className="space-y-1.5"><div className="skeleton h-3 w-24" /><div className="skeleton h-3" /></div>)}
                        </div>
                    ) : results.length === 0 ? (
                        <EmptyState compact title={`No matches for “${submittedQuery || query}”`} description={scope === 'current' ? 'Try “All open documents” in the scope menu.' : 'Check spelling or try a shorter phrase.'} />
                    ) : (
                        <>
                            <div ref={listRef} id={listId} role="listbox" aria-label="Search results" className="max-h-[60vh] overflow-y-auto">
                                {groups.map(group => (
                                    <div key={group.key} role="group" aria-label={group.key}>
                                        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line-soft bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text-soft">
                                            <FileText size={12} className="shrink-0" />
                                            <span className="truncate" title={group.key}>{group.key}</span>
                                            <span className="ml-auto shrink-0 font-normal text-text-muted">{group.items.length} {group.items.length === 1 ? 'match' : 'matches'}</span>
                                        </div>
                                        {group.items.map(({ result, index }) => {
                                            return (
                                                <ResultItem
                                                    key={`${result.docId}-${result.page}-${index}`}
                                                    id={`${listId}-${index}`}
                                                    index={index}
                                                    active={index === activeIndex}
                                                    result={result}
                                                    query={submittedQuery}
                                                    onHover={() => setActiveIndex(index)}
                                                    onClick={() => handleSelect(result)}
                                                />
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center justify-between border-t border-line-soft bg-surface-2 px-3 py-1.5 text-xs text-text-muted">
                                <span>{results.length}{results.length === RESULT_LIMIT ? '+' : ''} results</span>
                                <span className="flex items-center gap-2"><KeyCaps shortcut="ArrowUp" /><KeyCaps shortcut="ArrowDown" /> move <KeyCaps shortcut="Enter" /> open</span>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function ResultItem({ id, index, active, result, query, onHover, onClick }: {
    id: string;
    index: number;
    active: boolean;
    result: SearchResult;
    query: string;
    onHover: () => void;
    onClick: () => void;
}) {
    const segments = useMemo(() => highlightSegments(snippetAround(result.text, query, 70), query), [result.text, query]);
    return (
        <div
            id={id}
            data-index={index}
            role="option"
            aria-selected={active}
            onPointerMove={onHover}
            onClick={onClick}
            className={cn(
                "cursor-pointer border-b border-line-soft px-3 py-2 transition-colors duration-state last:border-b-0",
                active ? "bg-accent-soft" : "hover:bg-sunken",
            )}
        >
            <div className="mb-1 flex items-center gap-2">
                <span className="rounded-sm border border-line bg-surface-1 px-1.5 text-xs font-medium text-text-soft">p. {result.page}</span>
                {active && <span className="ml-auto text-xs text-accent">Enter to open</span>}
            </div>
            <p className="line-clamp-2 text-sm leading-snug text-text-soft">
                {segments.map((segment, segmentIndex) => segment.match
                    ? <mark key={segmentIndex} className="rounded-sm bg-hl-yellow px-0.5 text-ink-black">{segment.text}</mark>
                    : <span key={segmentIndex}>{segment.text}</span>)}
            </p>
        </div>
    );
}
