import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Search, X } from 'lucide-react';
import { localSearchRegistry, type SearchResult, type SearchSpan } from '@/lib/search/local-search';
import { useAppStore } from '@/lib/store';
import { FOCUS_SEARCH_EVENT } from '@/lib/ui/ui-store';
import { KeyCaps } from './KeyCaps';

export type { SearchResult, SearchSpan };

interface SearchBarProps {
    currentDocId?: string | null;
    onSelect: (result: SearchResult) => void;
}

const LIVE_DELAY_MS = 60;

/** Focused-PDF find: live literal matching, no result list, no OCR text. */
export function SearchBar({ currentDocId, onSelect }: SearchBarProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [focused, setFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const requestRef = useRef(0);
    const onSelectRef = useRef(onSelect);
    const setSearchMatches = useAppStore(state => state.setSearchMatches);
    const clearSearchHighlight = useAppStore(state => state.clearSearchHighlight);

    useEffect(() => {
        onSelectRef.current = onSelect;
    }, [onSelect]);

    const selectResult = useCallback((index: number, source: SearchResult[]) => {
        if (!source.length) return;
        const wrapped = (index + source.length) % source.length;
        setActiveIndex(wrapped);
        onSelectRef.current(source[wrapped]);
    }, []);

    const step = useCallback((direction: 1 | -1) => {
        if (!results.length) return;
        const start = activeIndex < 0 ? (direction === 1 ? 0 : results.length - 1) : activeIndex + direction;
        selectResult(start, results);
    }, [activeIndex, results, selectResult]);

    const clear = useCallback(() => {
        requestRef.current += 1;
        setQuery('');
        setResults([]);
        setActiveIndex(-1);
        setLoading(false);
        setFailed(false);
        clearSearchHighlight();
        inputRef.current?.focus();
    }, [clearSearchHighlight]);

    useEffect(() => {
        const focusSearch = () => {
            inputRef.current?.focus();
            inputRef.current?.select();
        };
        window.addEventListener(FOCUS_SEARCH_EVENT, focusSearch);
        return () => window.removeEventListener(FOCUS_SEARCH_EVENT, focusSearch);
    }, []);

    useEffect(() => {
        const text = query.trim();
        const request = ++requestRef.current;
        const timer = window.setTimeout(() => {
            if (!text || !currentDocId) {
                setResults([]);
                setActiveIndex(-1);
                setLoading(false);
                setFailed(false);
                clearSearchHighlight();
                return;
            }

            setLoading(true);
            setFailed(false);
            void localSearchRegistry.search(text, [currentDocId]).then(matches => {
                if (requestRef.current !== request) return;
                setResults(matches);
                setSearchMatches(matches);
                setLoading(false);
                if (matches.length) selectResult(0, matches);
                else {
                    setActiveIndex(-1);
                    useAppStore.getState().setSearchHighlight(null);
                }
            }).catch(error => {
                if (requestRef.current !== request) return;
                console.error('[SearchBar] Find in PDF failed:', error);
                setResults([]);
                setActiveIndex(-1);
                setLoading(false);
                setFailed(true);
                clearSearchHighlight();
            });
        }, text ? LIVE_DELAY_MS : 0);
        return () => window.clearTimeout(timer);
    }, [clearSearchHighlight, currentDocId, query, selectResult, setSearchMatches]);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            if (query) clear();
            else inputRef.current?.blur();
        }
    };

    const counter = failed
        ? 'Error'
        : query.trim() && !loading
            ? `${activeIndex >= 0 ? activeIndex + 1 : 0} / ${results.length}`
            : '';
    const iconButton = 'grid size-7 shrink-0 place-items-center rounded-md text-text-soft transition-colors duration-state hover:bg-surface-3 hover:text-text disabled:pointer-events-none disabled:opacity-30';

    return (
        <div
            className={`flex h-9 w-full min-w-0 items-center gap-0.5 rounded-lg border bg-sunken pl-2.5 pr-1 shadow-[var(--edge-press)] transition-[border-color,background-color,box-shadow] duration-state ${focused ? 'border-accent bg-surface-1 shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)]' : 'border-line hover:border-text-muted/40'} ${!currentDocId ? 'opacity-70' : ''}`}
        >
            {loading
                ? <Loader2 size={15} className="shrink-0 animate-spin text-text-muted" aria-hidden />
                : <Search size={15} className="shrink-0 text-text-muted" aria-hidden />}
            <label className="min-w-0 flex-1">
                <span className="sr-only">Find in PDF</span>
                <input
                    ref={inputRef}
                    type="search"
                    value={query}
                    disabled={!currentDocId}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={event => setQuery(event.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    placeholder={currentDocId ? 'Find in PDF…' : 'Open a PDF to search'}
                    className="h-8 w-full min-w-0 bg-transparent px-2 text-sm text-text outline-none placeholder:text-text-muted disabled:cursor-not-allowed [&::-webkit-search-cancel-button]:hidden"
                />
            </label>

            {!query && !focused && currentDocId && (
                <KeyCaps shortcut="Mod+F" className="mr-1 hidden shrink-0 opacity-80 md:inline-flex" />
            )}
            <span className="min-w-[52px] shrink-0 px-1 text-right font-mono text-[11px] tabular-nums text-text-muted" aria-live="polite">
                {counter}
            </span>
            <button type="button" className={iconButton} disabled={!results.length} onClick={() => step(-1)} aria-label="Previous match" title="Previous match (Shift+Enter)">
                <ChevronUp size={16} />
            </button>
            <button type="button" className={iconButton} disabled={!results.length} onClick={() => step(1)} aria-label="Next match" title="Next match (Enter)">
                <ChevronDown size={16} />
            </button>
            <button type="button" className={iconButton} disabled={!query} onClick={clear} aria-label="Clear find" title="Clear (Escape)">
                <X size={15} />
            </button>
        </div>
    );
}
