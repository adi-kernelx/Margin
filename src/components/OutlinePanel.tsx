import { useEffect, useMemo, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ChevronRight, FileText } from 'lucide-react';
import { pageIdForSourceIndex, visibleOutlineRows, type OutlineNode } from '@/core/ui/outline';
import type { PageRecord } from '@/core/pages/models';
import { cn } from '@/lib/utils';
import { EmptyState, Skeleton } from './ui/States';

type RawOutline = Awaited<ReturnType<pdfjsLib.PDFDocumentProxy['getOutline']>>;
type Destination = RawOutline[number]['dest'];

/** The source whose outline is shown; merged-in files keep their own outlines out. */
const OUTLINE_SOURCE = 'original';

interface OutlinePanelProps {
    /** Changes whenever a different document is shown. */
    documentKey: string;
    /** Bytes of a stored page source. The rendered document is rebuilt page by
     *  page and carries no outline, so the outline is read from the original. */
    loadSource: (sourceId: string) => Promise<Uint8Array | null | undefined>;
    pages: readonly PageRecord[];
    onNavigate: (pageId: string) => void;
}

interface LoadedOutline {
    key: string;
    nodes: OutlineNode[] | null;
    /** Outline node id → zero-based page index in the original source. */
    pageIndexById: Map<string, number>;
}

async function resolvePageIndex(pdfDoc: pdfjsLib.PDFDocumentProxy, dest: Destination): Promise<number | null> {
    try {
        const explicit = typeof dest === 'string' ? await pdfDoc.getDestination(dest) : dest;
        const ref = explicit?.[0];
        if (ref == null) return null;
        if (typeof ref === 'number') return ref;
        return await pdfDoc.getPageIndex(ref as Parameters<pdfjsLib.PDFDocumentProxy['getPageIndex']>[0]);
    } catch {
        return null;
    }
}

/**
 * Reads the outline and resolves every destination up front, so the PDF.js
 * document can be released immediately instead of living as long as the panel.
 */
async function readOutline(bytes: Uint8Array): Promise<Omit<LoadedOutline, 'key'>> {
    const pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    try {
        const raw = await pdfDoc.getOutline();
        if (!raw?.length) return { nodes: null, pageIndexById: new Map() };
        const pageIndexById = new Map<string, number>();
        const convert = async (items: RawOutline, prefix: string): Promise<OutlineNode[]> => Promise.all(items.map(async (item, index) => {
            const id = `${prefix}${index}`;
            const pageIndex = await resolvePageIndex(pdfDoc, item.dest);
            if (pageIndex !== null) pageIndexById.set(id, pageIndex);
            return { id, title: item.title || 'Untitled', children: await convert(item.items ?? [], `${id}.`) };
        }));
        return { nodes: await convert(raw, ''), pageIndexById };
    } finally {
        void pdfDoc.destroy();
    }
}

/**
 * The PDF's own table of contents. Falls back to a plain page list when the
 * file has no outline, so the tab is always useful for navigation.
 */
export function OutlinePanel({ documentKey, loadSource, pages, onNavigate }: OutlinePanelProps) {
    // Tagged with the document it was read for, so switching documents reads
    // as "loading" without resetting state inside the effect.
    const [loaded, setLoaded] = useState<LoadedOutline | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const current = loaded?.key === documentKey ? loaded : null;

    useEffect(() => {
        let cancelled = false;
        const empty = { key: documentKey, nodes: null, pageIndexById: new Map<string, number>() };
        void loadSource(OUTLINE_SOURCE)
            .then(bytes => (bytes ? readOutline(bytes) : empty))
            .then(result => { if (!cancelled) setLoaded({ ...result, key: documentKey }); })
            .catch(() => { if (!cancelled) setLoaded(empty); });
        return () => { cancelled = true; };
    }, [documentKey, loadSource]);

    const rows = useMemo(() => visibleOutlineRows(current?.nodes ?? [], expanded), [current, expanded]);

    const toggle = (id: string) => setExpanded(previous => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });

    const open = (id: string) => {
        const index = current?.pageIndexById.get(id);
        if (index === undefined) return;
        const pageId = pageIdForSourceIndex(pages, index, OUTLINE_SOURCE);
        if (pageId) onNavigate(pageId);
    };

    if (!current) {
        return <div className="space-y-3 p-4" aria-busy="true">{[0, 1, 2, 3].map(row => <Skeleton key={row} className="h-4" />)}</div>;
    }

    if (!current.nodes) {
        if (!pages.length) return <EmptyState compact title="No pages" />;
        return (
            <div className="flex-1 overflow-y-auto p-2">
                <p className="px-2 pb-2 text-xs text-text-muted">This PDF has no table of contents. Jump to a page:</p>
                <ul className="grid grid-cols-4 gap-1.5">
                    {pages.map((page, index) => (
                        <li key={page.id}>
                            <button onClick={() => onNavigate(page.id)} className="depth-pressable flex h-9 w-full items-center justify-center gap-1 border border-line text-xs text-text-soft">
                                <FileText size={11} />{index + 1}
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        );
    }

    return (
        <ul role="tree" aria-label="Table of contents" className="flex-1 overflow-y-auto p-2">
            {rows.map(row => {
                // An entry whose page was deleted stays visible but inert.
                const index = current.pageIndexById.get(row.node.id);
                const reachable = index !== undefined && pageIdForSourceIndex(pages, index, OUTLINE_SOURCE) !== null;
                return (
                    <li key={row.node.id} role="treeitem" aria-level={row.depth + 1} aria-expanded={row.hasChildren ? row.expanded : undefined}>
                        <div className="group flex items-center rounded transition-colors duration-state hover:bg-sunken" style={{ paddingLeft: row.depth * 14 }}>
                            {row.hasChildren ? (
                                <button className="grid size-6 shrink-0 place-items-center text-text-muted hover:text-text" aria-label={row.expanded ? `Collapse ${row.node.title}` : `Expand ${row.node.title}`} onClick={() => toggle(row.node.id)}>
                                    <ChevronRight size={13} className={cn('transition-transform duration-state', row.expanded && 'rotate-90')} />
                                </button>
                            ) : <span className="size-6 shrink-0" />}
                            <button
                                className={cn(
                                    'min-w-0 flex-1 truncate py-1.5 pr-2 text-left text-sm disabled:cursor-default disabled:opacity-50',
                                    row.depth === 0 ? 'font-medium text-text' : 'text-text-soft',
                                )}
                                title={reachable ? row.node.title : `${row.node.title} (page removed)`}
                                disabled={!reachable}
                                onClick={() => open(row.node.id)}
                            >
                                {row.node.title}
                            </button>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
