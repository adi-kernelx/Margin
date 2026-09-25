// Pure outline (table of contents) helpers. The shell reads the tree from
// PDF.js and resolves destinations to page indexes; this module only decides
// which rows are visible and which page record a source page maps to.

export interface OutlineNode {
    id: string;
    title: string;
    children: OutlineNode[];
}

export interface OutlineRow {
    node: OutlineNode;
    depth: number;
    hasChildren: boolean;
    expanded: boolean;
}

/** Flattens the tree to the rows currently visible given the expanded set. */
export function visibleOutlineRows(nodes: readonly OutlineNode[], expanded: ReadonlySet<string>, depth = 0): OutlineRow[] {
    const rows: OutlineRow[] = [];
    for (const node of nodes) {
        const hasChildren = node.children.length > 0;
        const isExpanded = hasChildren && expanded.has(node.id);
        rows.push({ node, depth, hasChildren, expanded: isExpanded });
        if (isExpanded) rows.push(...visibleOutlineRows(node.children, expanded, depth + 1));
    }
    return rows;
}

interface PageLike {
    id: string;
    kind: string;
    sourceId?: string;
    sourcePageIndex?: number;
}

/**
 * Maps a page index in a source PDF to the current page record. Pages can be
 * reordered, deleted or merged in from other files after load, so an outline
 * entry pointing at "page 5 of the original" must follow that page, not the
 * fifth slot, and must not land on page 5 of a merged-in document.
 */
export function pageIdForSourceIndex(pages: readonly PageLike[], sourcePageIndex: number, sourceId?: string): string | null {
    return pages.find(page => page.kind === 'pdf'
        && page.sourcePageIndex === sourcePageIndex
        && (sourceId === undefined || page.sourceId === sourceId))?.id ?? null;
}
