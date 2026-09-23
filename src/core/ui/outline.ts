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
    sourcePageIndex?: number;
}

/**
 * Maps an original-document page index to the current page record. Pages can
 * be reordered or deleted after load, so a PDF outline entry pointing at
 * "page 5" must follow that page, not the fifth slot.
 */
export function pageIdForSourceIndex(pages: readonly PageLike[], sourcePageIndex: number): string | null {
    return pages.find(page => page.kind === 'pdf' && page.sourcePageIndex === sourcePageIndex)?.id ?? null;
}
