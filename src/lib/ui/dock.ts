// Per-document dock preferences, kept outside the component module so the
// component file only exports components (fast refresh).

export type DockTab = 'notes' | 'outline';

export function dockTabKey(documentId: string) {
    return `margin:dock-tab:${documentId}`;
}

/** The dock's last tab for a document, so reopening lands where the user left. */
export function readDockTab(documentId: string): DockTab {
    try {
        return window.localStorage.getItem(dockTabKey(documentId)) === 'outline' ? 'outline' : 'notes';
    } catch {
        return 'notes';
    }
}
