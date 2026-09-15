export type SplitDirection = 'horizontal' | 'vertical';
export type DropPlacement = 'center' | 'left' | 'right' | 'top' | 'bottom';
export const WORKSPACE_TAB_MIME = 'application/x-margin-tab';

export interface PaneLeaf {
    type: 'pane';
    id: string;
    tabs: string[];
    activeTabId: string | null;
}

export interface PaneSplit {
    type: 'split';
    id: string;
    direction: SplitDirection;
    children: [LayoutNode, LayoutNode];
    sizes: [number, number];
}

export type LayoutNode = PaneLeaf | PaneSplit;

const MIN_PANE_SHARE = 0.15;

export function createLayout(paneId: string): PaneLeaf {
    return { type: 'pane', id: paneId, tabs: [], activeTabId: null };
}

export function countPanes(node: LayoutNode): number {
    return node.type === 'pane'
        ? 1
        : countPanes(node.children[0]) + countPanes(node.children[1]);
}

export function firstPaneId(node: LayoutNode): string {
    return node.type === 'pane' ? node.id : firstPaneId(node.children[0]);
}

export function paneIdForTab(node: LayoutNode, tabId: string): string | null {
    if (node.type === 'pane') return node.tabs.includes(tabId) ? node.id : null;
    return paneIdForTab(node.children[0], tabId) ?? paneIdForTab(node.children[1], tabId);
}

export function visibleTabIds(node: LayoutNode): string[] {
    if (node.type === 'pane') return node.activeTabId ? [node.activeTabId] : [];
    return [...visibleTabIds(node.children[0]), ...visibleTabIds(node.children[1])];
}

function mapPane(node: LayoutNode, paneId: string, update: (pane: PaneLeaf) => PaneLeaf): LayoutNode {
    if (node.type === 'pane') return node.id === paneId ? update(node) : node;
    const first = mapPane(node.children[0], paneId, update);
    const second = mapPane(node.children[1], paneId, update);
    if (first === node.children[0] && second === node.children[1]) return node;
    return { ...node, children: [first, second] };
}

export function addTabs(node: LayoutNode, paneId: string, tabIds: readonly string[]): LayoutNode {
    const unique = tabIds.filter((tabId, index) => tabIds.indexOf(tabId) === index);
    if (unique.length === 0) return node;

    return mapPane(node, paneId, (pane) => {
        const additions = unique.filter((tabId) => !pane.tabs.includes(tabId));
        if (additions.length === 0) return pane;
        return {
            ...pane,
            tabs: [...pane.tabs, ...additions],
            activeTabId: pane.activeTabId ?? additions[0],
        };
    });
}

export function activateTab(node: LayoutNode, tabId: string): LayoutNode {
    const paneId = paneIdForTab(node, tabId);
    if (!paneId) return node;
    return mapPane(node, paneId, (pane) =>
        pane.activeTabId === tabId ? pane : { ...pane, activeTabId: tabId },
    );
}

function removeTabInternal(node: LayoutNode, tabId: string, keepEmptyRoot: boolean): LayoutNode | null {
    if (node.type === 'pane') {
        if (!node.tabs.includes(tabId)) return node;
        const tabs = node.tabs.filter((id) => id !== tabId);
        if (tabs.length === 0 && !keepEmptyRoot) return null;
        return {
            ...node,
            tabs,
            activeTabId: node.activeTabId === tabId ? (tabs[0] ?? null) : node.activeTabId,
        };
    }

    const first = removeTabInternal(node.children[0], tabId, false);
    const second = removeTabInternal(node.children[1], tabId, false);
    if (!first) return second;
    if (!second) return first;
    if (first === node.children[0] && second === node.children[1]) return node;
    return { ...node, children: [first, second] };
}

export function removeTab(node: LayoutNode, tabId: string, emptyPaneId: string): LayoutNode {
    return removeTabInternal(node, tabId, true) ?? createLayout(emptyPaneId);
}

export function moveTab(node: LayoutNode, tabId: string, targetPaneId: string): LayoutNode {
    const sourcePaneId = paneIdForTab(node, tabId);
    if (!sourcePaneId) return node;
    if (sourcePaneId === targetPaneId) return activateTab(node, tabId);

    const withoutTab = removeTabInternal(node, tabId, true);
    if (!withoutTab || !containsPane(withoutTab, targetPaneId)) return node;
    return activateTab(addTabs(withoutTab, targetPaneId, [tabId]), tabId);
}

function containsPane(node: LayoutNode, paneId: string): boolean {
    if (node.type === 'pane') return node.id === paneId;
    return containsPane(node.children[0], paneId) || containsPane(node.children[1], paneId);
}

export function splitPane(
    node: LayoutNode,
    tabId: string,
    targetPaneId: string,
    placement: Exclude<DropPlacement, 'center'>,
    newPaneId: string,
    splitId: string,
    maxPanes = 4,
): LayoutNode {
    if (countPanes(node) >= maxPanes) return node;
    const sourcePaneId = paneIdForTab(node, tabId);
    if (!sourcePaneId) return node;
    if (sourcePaneId === targetPaneId) {
        const source = getPane(node, sourcePaneId);
        if (!source || source.tabs.length === 1) return node;
    }

    const withoutTab = removeTabInternal(node, tabId, true);
    if (!withoutTab || !containsPane(withoutTab, targetPaneId)) return node;

    const direction: SplitDirection = placement === 'left' || placement === 'right'
        ? 'horizontal'
        : 'vertical';
    const newPane: PaneLeaf = { type: 'pane', id: newPaneId, tabs: [tabId], activeTabId: tabId };
    const newFirst = placement === 'left' || placement === 'top';

    return replacePane(withoutTab, targetPaneId, (target) => ({
        type: 'split',
        id: splitId,
        direction,
        children: newFirst ? [newPane, target] : [target, newPane],
        sizes: [0.5, 0.5],
    }));
}

export function resizeSplit(node: LayoutNode, splitId: string, firstShare: number): LayoutNode {
    if (node.type === 'pane') return node;
    const clamped = Math.min(1 - MIN_PANE_SHARE, Math.max(MIN_PANE_SHARE, firstShare));
    if (node.id === splitId) return { ...node, sizes: [clamped, 1 - clamped] };
    const first = resizeSplit(node.children[0], splitId, firstShare);
    const second = resizeSplit(node.children[1], splitId, firstShare);
    if (first === node.children[0] && second === node.children[1]) return node;
    return { ...node, children: [first, second] };
}

export function getPane(node: LayoutNode, paneId: string): PaneLeaf | null {
    if (node.type === 'pane') return node.id === paneId ? node : null;
    return getPane(node.children[0], paneId) ?? getPane(node.children[1], paneId);
}

function replacePane(
    node: LayoutNode,
    paneId: string,
    replacement: (pane: PaneLeaf) => LayoutNode,
): LayoutNode {
    if (node.type === 'pane') return node.id === paneId ? replacement(node) : node;
    const first = replacePane(node.children[0], paneId, replacement);
    const second = replacePane(node.children[1], paneId, replacement);
    if (first === node.children[0] && second === node.children[1]) return node;
    return { ...node, children: [first, second] };
}
