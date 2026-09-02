import { useEffect, useState, useContext, useRef } from 'react';
import type { DocumentEntry } from '@/types';
import { PDFViewer } from './PDFViewer';
import { Toolbar } from './Toolbar';
import { DocumentProvider, DocumentContext } from '@/contexts/DocumentContext';
import { useAppStore } from '@/lib/store';
import { operationManager } from '@/lib/annotations/operation-manager';
import { saveManager } from '@/lib/saving/save-manager';
import { useDocModified } from '@/components/SaveButton';
import { SaveOptionsModal } from '@/components/SaveOptionsModal';

interface DocumentPaneProps {
    doc: DocumentEntry;
    replicateToolbar: boolean;
    onClose?: (id: string) => void;
}

export function DocumentPane({ doc, replicateToolbar }: DocumentPaneProps) {
    const globalState = useAppStore(state => state);

    return (
        <DocumentProvider initialState={globalState}>
            <PaneContent
                doc={doc}
                replicateToolbar={replicateToolbar}
            />
        </DocumentProvider>
    );
}

function PaneContent({ doc, replicateToolbar }: DocumentPaneProps) {
    // We are now INSIDE the local store context
    // We need to sync tools from global store IF !replicateToolbar
    const localStore = useContext(DocumentContext);
    const prevGlobalScale = useRef(useAppStore.getState().scale);
    const isModified = useDocModified(doc.id);
    const [showSaveOptions, setShowSaveOptions] = useState(false);

    // Subscribe to global store changes
    useEffect(() => {
        if (!localStore) return;

        // Subscribe to global store
        const unsub = useAppStore.subscribe((state) => {
            const updates: any = {};

            // 1. Tool State Sync (Only when NOT replicated)
            // If toolbar is replicated, tools are independent.
            if (!replicateToolbar) {
                Object.assign(updates, {
                    annotationMode: state.annotationMode,
                    highlighterColor: state.highlighterColor,
                    highlighterMode: state.highlighterMode,
                    highlighterOpacity: state.highlighterOpacity,
                    eraserMode: state.eraserMode,
                    pencilColor: state.pencilColor,
                    rectangleColor: state.rectangleColor,
                    arrowColor: state.arrowColor,
                    textColor: state.textColor,
                    textBackgroundColor: state.textBackgroundColor,
                    textFontSize: state.textFontSize,
                    selectionMode: state.selectionMode,
                });
            }

            // 2. Global Preferences (Always Sync)
            updates.isDarkMode = state.isDarkMode;

            // 3. Scale Sync (Smart Sync)
            // If global scale changes, force update local scale.
            // This allows Global Toolbar Zoom buttons to work even in Split Mode.
            if (state.scale !== prevGlobalScale.current) {
                updates.scale = state.scale;
                prevGlobalScale.current = state.scale;
            }

            if (Object.keys(updates).length > 0) {
                localStore.setState(updates);
            }
        });

        return () => unsub();
    }, [replicateToolbar, localStore]);



    const { setFocusedDocId } = useAppStore();

    return (
        <div
            className="document relative w-full h-full flex flex-col group bg-white dark:bg-gray-800 border-r border-b dark:border-gray-700"
            data-doc-id={doc.id}
            onMouseEnter={() => setFocusedDocId(doc.id)}
            onTouchStart={() => setFocusedDocId(doc.id)}
        >
            <div className="flex-1 relative overflow-hidden">
                {replicateToolbar && (
                    <div className="absolute top-4 left-4 bottom-4 z-20 w-fit flex flex-col pointer-events-none">
                        <div className="pointer-events-auto h-full flex flex-col">
                            <Toolbar
                                className="relative h-full"
                                onUndo={() => operationManager.undoLocal(doc.id)}
                                onRedo={() => operationManager.redoLocal(doc.id)}
                                canUndo={true} // TODO: State
                                canRedo={true}
                                onSave={() => saveManager.saveDoc(doc.id)}
                                onOpenSaveOptions={() => setShowSaveOptions(true)}
                                isModified={isModified}
                                readOnly={doc.role === 'viewer'}
                            />
                        </div>
                    </div>
                )}

                {replicateToolbar && (
                    <SaveOptionsModal
                        isOpen={showSaveOptions}
                        onClose={() => setShowSaveOptions(false)}
                        mode="local"
                        docId={doc.id}
                    />
                )}

                <PDFViewer
                    file={doc.file || null}
                    fileUrl={doc.fileUrl}
                    fileId={doc.id}
                    stableId={doc.stableId}
                    parentFolderId={doc.parentFolderId}
                    role={doc.role}
                    displayName={doc.name}
                />
            </div>
        </div>
    );
}
