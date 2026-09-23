import { useEffect, useMemo, useState } from 'react';
import type * as pdfjsLib from 'pdfjs-dist';
import { ChevronRight, FileText } from 'lucide-react';
import { pageIdForSourceIndex, visibleOutlineRows, type OutlineNode } from '@/core/ui/outline';
import type { PageRecord } from '@/core/pages/models';
import { cn } from '@/lib/utils';
import { EmptyState, Skeleton } from './ui/States';

type RawOutline = Awaited<ReturnType<pdfjsLib.PDFDocumentProxy['getOutline']>>;
type Destination = RawOutline[number]['dest'];

interface OutlinePanelProps {
    pdfDoc: pdfjsLib.PDFDocumentProxy | null;
    pages: readonly PageRecord[];
    onNavigate: (pageId: string) => void;
}

function toNodes(items: RawOutline, prefix = ''): OutlineNode[] {
    return items.map((item, index) => ({
        id: `${prefix}${index}`,
        title: item.title || 'Untitled',
        children: toNodes(item.items ?? [], `${prefix}${index}.`),
    }));
}

function destinationsById(items: RawOutline, prefix = '', into = new Map<string, Destination>()): Map<string, Destination> {
    items.forEach((item, index) => {
        into.set(`${prefix}${index}`, item.dest);
        destinationsById(item.items ?? [], `${prefix}${index}.`, into);
    });
    return into;
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
 * The PDF's own table of contents. Falls back to a plain page list when the
 * file has no outline, so the tab is always useful for navigation.
 */
export function OutlinePanel({ pdfDoc, pages, onNavigate }: OutlinePanelProps) {
    // Tagged with the document it was read from, so a new document reads as
    // "loading" without resetting state inside the effect.
    const [loaded, setLoaded] = useState<{ doc: pdfjsLib.PDFDocumentProxy; outline: RawOutline | null } | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const outline = pdfDoc && loaded?.doc === pdfDoc ? loaded.outline : undefined;

    useEffect(() => {
        if (!pdfDoc) return;
        let cancelled = false;
        void pdfDoc.getOutline().then(result => { if (!cancelled) setLoaded({ doc: pdfDoc, outline: result?.length ? result : null }); })
            .catch(() => { if (!cancelled) setLoaded({ doc: pdfDoc, outline: null }); });
        return () => { cancelled = true; };
    }, [pdfDoc]);

    const nodes = useMemo(() => (outline ? toNodes(outline) : []), [outline]);
    const destinations = useMemo(() => (outline ? destinationsById(outline) : new Map<string, Destination>()), [outline]);
    const rows = useMemo(() => visibleOutlineRows(nodes, expanded), [nodes, expanded]);

    const toggle = (id: string) => setExpanded(previous => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });

    const open = async (id: string) => {
        if (!pdfDoc) return;
        const index = await resolvePageIndex(pdfDoc, destinations.get(id) ?? null);
        if (index === null) return;
        const pageId = pageIdForSourceIndex(pages, index);
        if (pageId) onNavigate(pageId);
    };

    if (!pdfDoc || outline === undefined) {
        return <div className="space-y-3 p-4" aria-busy="true">{[0, 1, 2, 3].map(row => <Skeleton key={row} className="h-4" />)}</div>;
    }

    if (outline === null) {
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
            {rows.map(row => (
                <li key={row.node.id} role="treeitem" aria-level={row.depth + 1} aria-expanded={row.hasChildren ? row.expanded : undefined}>
                    <div className="group flex items-center rounded transition-colors duration-state hover:bg-sunken" style={{ paddingLeft: row.depth * 14 }}>
                        {row.hasChildren ? (
                            <button className="grid size-6 shrink-0 place-items-center text-text-muted hover:text-text" aria-label={row.expanded ? `Collapse ${row.node.title}` : `Expand ${row.node.title}`} onClick={() => toggle(row.node.id)}>
                                <ChevronRight size={13} className={cn('transition-transform duration-state', row.expanded && 'rotate-90')} />
                            </button>
                        ) : <span className="size-6 shrink-0" />}
                        <button
                            className={cn('min-w-0 flex-1 truncate py-1.5 pr-2 text-left text-sm', row.depth === 0 ? 'font-medium text-text' : 'text-text-soft')}
                            title={row.node.title}
                            onClick={() => void open(row.node.id)}
                        >
                            {row.node.title}
                        </button>
                    </div>
                </li>
            ))}
        </ul>
    );
}
