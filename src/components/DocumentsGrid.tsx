import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { DocumentEntry } from '@/types';
import type { DropPlacement, LayoutNode, PaneLeaf, PaneSplit } from '@/core/workspace/layout';
import { countPanes, moveTab, resizeSplit, splitPane, WORKSPACE_TAB_MIME } from '@/core/workspace/layout';
import { DocumentPane } from './DocumentPane';
import { ResizablePanelGroup } from './ui/ResizablePanelGroup';
import './grid-presets.css';

interface DocumentsGridProps {
    documents: DocumentEntry[];
    layout: LayoutNode;
    setLayout: Dispatch<SetStateAction<LayoutNode>>;
    replicateToolbar: boolean;
    onFocusDocument: (docId: string) => void;
}

export function DocumentsGrid({ documents, layout, setLayout, replicateToolbar, onFocusDocument }: DocumentsGridProps) {
    const documentsById = new Map(documents.map((document) => [document.id, document]));

    return (
        <main className="workspace-grid" aria-label="Document workspace">
            <LayoutBranch
                node={layout}
                documentsById={documentsById}
                paneCount={countPanes(layout)}
                setLayout={setLayout}
                replicateToolbar={replicateToolbar}
                onFocusDocument={onFocusDocument}
            />
        </main>
    );
}

interface LayoutBranchProps {
    node: LayoutNode;
    documentsById: Map<string, DocumentEntry>;
    paneCount: number;
    setLayout: Dispatch<SetStateAction<LayoutNode>>;
    replicateToolbar: boolean;
    onFocusDocument: (docId: string) => void;
}

function LayoutBranch(props: LayoutBranchProps) {
    const { node } = props;
    if (node.type === 'pane') return <WorkspacePane pane={node} {...props} />;
    return <WorkspaceSplit split={node} {...props} />;
}

function WorkspaceSplit({ split, setLayout, ...branchProps }: Omit<LayoutBranchProps, 'node'> & { split: PaneSplit }) {
    const isHorizontal = split.direction === 'horizontal';

    return (
        <ResizablePanelGroup
            direction={split.direction}
            firstShare={split.sizes[0]}
            onResize={(share) => setLayout((current) => resizeSplit(current, split.id, share))}
            label={`Resize ${isHorizontal ? 'left and right' : 'top and bottom'} panes`}
        >
            <>
                <LayoutBranch node={split.children[0]} setLayout={setLayout} {...branchProps} />
            </>
            <>
                <LayoutBranch node={split.children[1]} setLayout={setLayout} {...branchProps} />
            </>
        </ResizablePanelGroup>
    );
}

function WorkspacePane({ pane, documentsById, paneCount, setLayout, replicateToolbar, onFocusDocument }: Omit<LayoutBranchProps, 'node'> & { pane: PaneLeaf }) {
    const [dropPlacement, setDropPlacement] = useState<DropPlacement | null>(null);
    const document = pane.activeTabId ? documentsById.get(pane.activeTabId) : undefined;

    const detectPlacement = (event: React.DragEvent<HTMLDivElement>): DropPlacement => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width;
        const y = (event.clientY - bounds.top) / bounds.height;
        if (x < 0.25) return 'left';
        if (x > 0.75) return 'right';
        if (y < 0.25) return 'top';
        if (y > 0.75) return 'bottom';
        return 'center';
    };

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        if (!event.dataTransfer.types.includes(WORKSPACE_TAB_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropPlacement(detectPlacement(event));
    };

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const tabId = event.dataTransfer.getData(WORKSPACE_TAB_MIME);
        const placement = dropPlacement ?? detectPlacement(event);
        setDropPlacement(null);
        if (!tabId) return;

        setLayout((current) => placement === 'center'
            ? moveTab(current, tabId, pane.id)
            : splitPane(current, tabId, pane.id, placement, crypto.randomUUID(), crypto.randomUUID()));
        onFocusDocument(tabId);
    };

    return (
        <section
            className="workspace-pane"
            aria-label={document ? `Document pane: ${document.name}` : 'Empty document pane'}
            onDragOver={handleDragOver}
            onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropPlacement(null);
            }}
            onDrop={handleDrop}
        >
            {document ? (
                <DocumentPane doc={document} replicateToolbar={replicateToolbar} />
            ) : (
                <div className="workspace-pane__empty">Drag a tab here</div>
            )}
            {dropPlacement && (
                <div className={`workspace-drop workspace-drop--${dropPlacement}`} aria-hidden="true">
                    <span>
                        {dropPlacement === 'center'
                            ? 'Move to pane'
                            : paneCount >= 4 ? 'Four-pane limit' : `Split ${dropPlacement}`}
                    </span>
                </div>
            )}
        </section>
    );
}
