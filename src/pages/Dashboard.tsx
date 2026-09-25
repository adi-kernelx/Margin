
import { lazy, Suspense, useState, useRef, useEffect } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { DocumentsGrid } from '@/components/DocumentsGrid';
import { Header } from '@/components/Header';
import { PermissionPrompt } from '@/components/PermissionPrompt';
import type { DocumentEntry } from '@/types';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { useKeyboardShortcuts } from '@/lib/hooks/useKeyboardShortcuts';
import { operationManager } from '@/lib/annotations/operation-manager';
import { useSaveStore } from '@/lib/saving/save-manager';
import type { SaveStoreState } from '@/lib/saving/save-manager';
import { localFileDB } from '@/lib/storage/local-file-db';
import type { LocalFile } from '@/types/editor-types';
import { computeStableId, computeStableIdForFile } from '@/lib/doc-id';
import type { LayoutNode } from '@/core/workspace/layout';
import { createFileIdentity } from '@/core/library/references';
import {
    activateTab,
    addTabs,
    countPanes,
    createLayout,
    firstPaneId,
    paneIdForTab,
    removeTab,
    visibleTabIds,
} from '@/core/workspace/layout';

import { ToastContainer } from '@/components/ui/Toast';
import { StatusBar } from '@/components/StatusBar';
import { startServiceHealthPolling } from '@/lib/services/health';
import { ASSISTANT_ENABLED, IS_DEMO, SERVICES_ENABLED } from '@/lib/features';
import { Button } from '@/components/ui/Button';
import { LibraryGrid } from '@/components/LibraryGrid';
import { libraryDB } from '@/lib/storage/library-db';
import { ROOT_FOLDER_ID, type LibraryFile } from '@/types/library';
import { CommandLayer } from '@/components/CommandLayer';
import { CoachMarks } from '@/components/CoachMarks';
import { EmptyState, PaperStackArt } from '@/components/ui/States';
import { WorkspaceCommands } from '@/components/WorkspaceCommands';

// Loaded on first open; compiled out entirely when the assistant is disabled.
const AIChatSidebar = ASSISTANT_ENABLED
    ? lazy(() => import('@/components/AIChatSidebar').then(module => ({ default: module.AIChatSidebar })))
    : null;

// Demo-only surfaces live in their own chunk and are absent from the normal build.
const DemoShowcase = IS_DEMO
    ? lazy(() => import('@/demo/DemoShowcase').then(module => ({ default: module.DemoShowcase })))
    : null;
const DemoBanner = IS_DEMO
    ? lazy(() => import('@/demo/DemoBanner').then(module => ({ default: module.DemoBanner })))
    : null;

// Pending permission request info
interface PendingPermission {
    docId: string;
    fileName: string;
    handle: FileSystemFileHandle;
}

async function loadLibraryDocument(entry: LibraryFile): Promise<{ document?: DocumentEntry; error?: string }> {
    const access = await libraryDB.openFile(entry.id, true);
    if (access.status === 'permission-required') return { error: 'Permission is required to read this PDF reference.' };
    if (access.status === 'missing-source') return { error: 'The referenced PDF was moved, deleted, or is no longer available.' };
    if (access.status !== 'ready') return { error: 'This library entry no longer exists.' };
    const file = access.file;
    const stableId = access.handle ? await computeStableId(access.handle) : await computeStableIdForFile(file);
    const now = Date.now();
    const existing = await localFileDB.getLocalFile(entry.id);
    if (existing) {
        await localFileDB.updateLocalFile(entry.id, { pdfFingerprint: stableId, displayName: entry.name, pdfFileHandle: access.handle });
    } else {
        await localFileDB.createLocalFile({
            localFileId: entry.id,
            pdfFingerprint: stableId,
            displayName: entry.name,
            autosaveEnabled: false,
            autosaveIntervalSec: 10,
            createdAt: entry.createdAt,
            updatedAt: now,
            pdfFileHandle: access.handle,
        });
    }
    await libraryDB.updateFileMetadata(entry.id, { lastOpenedAt: now, lastReadPage: entry.lastReadPage ?? 1 });
    return { document: {
        id: entry.id,
        stableId,
        pdfFingerprint: stableId,
        name: entry.name,
        file,
        fileUrl: URL.createObjectURL(file),
        fileHandle: access.handle,
    } };
}

export default function Dashboard() {
    const [documents, setDocuments] = useState<DocumentEntry[]>([]);
    const [workspaceLayout, setWorkspaceLayout] = useState<LayoutNode>(() => createLayout('pane-root'));
    const [replicateToolbar, setReplicateToolbar] = useState(false);
    const [showLibrary, setShowLibrary] = useState(true);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pendingImportFolderRef = useRef(ROOT_FOLDER_ID);

    // Permission prompt state
    const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);

    const { focusedDocId, setFocusedDocId } = useAppStore();

    // Global Unsaved Changes Warning
    const isDirtyByPdf = useSaveStore((state: SaveStoreState) => state.isDirtyByPdf);

    // Theme is owned by ThemeProvider (see src/lib/theme). The old isDarkMode
    // store field and the direct classList toggle here fought it and produced
    // a light flash on reload; both are gone.

    // Kick off service-health polling once. The store is a singleton, so a
    // second call is a no-op.
    useEffect(() => { if (SERVICES_ENABLED) startServiceHealthPolling(); }, []);

    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            const isDirty = Object.values(isDirtyByPdf).some(Boolean);
            if (isDirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isDirtyByPdf]);

    // Listen for PDF fingerprint updates (for search functionality)
    useEffect(() => {
        const handlePdfLoaded = (e: CustomEvent<{ fileId: string; fingerprint: string }>) => {
            const { fileId, fingerprint } = e.detail;
            setDocuments(prev => prev.map(doc =>
                doc.id === fileId ? { ...doc, pdfFingerprint: fingerprint } : doc
            ));
        };
        window.addEventListener('pdf-loaded', handlePdfLoaded as EventListener);
        return () => window.removeEventListener('pdf-loaded', handlePdfLoaded as EventListener);
    }, []);

    useKeyboardShortcuts({
        onUndo: () => operationManager.undoGlobal(),
        onRedo: () => operationManager.redoGlobal(),
        onDelete: () => { }
    });

    const addDocumentsToWorkspace = (newDocs: DocumentEntry[]) => {
        if (newDocs.length === 0) return;
        setDocuments((previous) => [...previous, ...newDocs]);
        setWorkspaceLayout((current) => {
            const targetPaneId = (focusedDocId && paneIdForTab(current, focusedDocId)) || firstPaneId(current);
            return activateTab(addTabs(current, targetPaneId, newDocs.map((doc) => doc.id)), newDocs[0].id);
        });
        setFocusedDocId(newDocs[0].id);
        setShowLibrary(false);
    };

    const handleOpenLibraryFile = async (entry: LibraryFile) => {
        const alreadyOpen = documents.find(document => document.id === entry.id);
        if (alreadyOpen) {
            focusDocument(alreadyOpen.id);
            setShowLibrary(false);
            return;
        }
        const result = await loadLibraryDocument(entry);
        if (!result.document) {
            window.alert(result.error ?? 'Could not open this PDF reference.');
            return;
        }
        if (result.document.fileHandle) {
            useSaveStore.getState().setFileHandle(result.document.id, result.document.fileHandle);
        } else {
            useSaveStore.getState().setNeedsUserAction(result.document.id, { reason: 'no-handle' });
        }
        addDocumentsToWorkspace([result.document]);
    };

    const focusDocument = (docId: string) => {
        setWorkspaceLayout((current) => activateTab(current, docId));
        setFocusedDocId(docId);
    };

    // Handle permission prompt response
    const handlePermissionAllow = async () => {
        if (!pendingPermission) return;

        const { docId, handle } = pendingPermission;

        try {
            const permission = await (handle as any).requestPermission({ mode: 'readwrite' });
            const granted = permission === 'granted';

            useSaveStore.getState().setPermissionGranted(docId, granted);

            if (granted) {
                useSaveStore.getState().setAutosaveEnabled(docId, true);
            }
        } catch (err) {
            console.error('Permission request failed:', err);
        }

        setPendingPermission(null);
    };

    const handlePermissionDeny = () => {
        setPendingPermission(null);
    };

    const handleOpenPDF = async (targetFolderId = ROOT_FOLDER_ID) => {
        pendingImportFolderRef.current = targetFolderId;
        if ('showOpenFilePicker' in window) {
            try {
                const handles = await (window as any).showOpenFilePicker({
                    multiple: true,
                    types: [{ description: 'PDF Documents', accept: { 'application/pdf': ['.pdf'] } }],
                });

                const newDocs: DocumentEntry[] = [];
                let firstUnpermittedDoc: PendingPermission | null = null;

                for (let i = 0; i < handles.length; i++) {
                    const handle = handles[i] as FileSystemFileHandle;
                    const file = await handle.getFile();
                    const libraryEntry = await libraryDB.addFileReference(handle, targetFolderId);
                    const docId = libraryEntry.id;
                    const stableId = await computeStableId(handle);

                    // Check if we have seen this file before (by fingerprint)
                    const existingRecord = await localFileDB.findLocalFileByFingerprint(stableId);

                    // Persist to IDB
                    const localFile: LocalFile = {
                        localFileId: docId,
                        pdfFingerprint: stableId,
                        displayName: file.name,
                        pdfFileHandle: handle,
                        // Restore JSON handle if it exists from previous session
                        jsonFileHandle: existingRecord?.jsonFileHandle,
                        lastSavedAt: existingRecord?.lastSavedAt || Date.now(),
                        updatedAt: Date.now(),
                        // Inherit autosave settings if desired, or default
                        autosaveEnabled: existingRecord?.autosaveEnabled ?? false,
                        autosaveIntervalSec: existingRecord?.autosaveIntervalSec ?? 10,
                        createdAt: existingRecord?.createdAt || Date.now()
                    };
                    await localFileDB.createLocalFile(localFile);

                    useSaveStore.getState().setFileHandle(docId, handle);

                    let permissionGranted = false;
                    try {
                        const currentPerm = await (handle as any).queryPermission({ mode: 'readwrite' });
                        permissionGranted = currentPerm === 'granted';
                    } catch { }

                    useSaveStore.getState().setPermissionGranted(docId, permissionGranted);

                    if (!permissionGranted && !firstUnpermittedDoc) {
                        firstUnpermittedDoc = { docId, fileName: file.name, handle };
                    } else if (permissionGranted) {
                        useSaveStore.getState().setAutosaveEnabled(docId, true);
                    }

                    const arrayBuffer = await file.arrayBuffer();
                    const memoryBlob = new Blob([arrayBuffer], { type: 'application/pdf' });
                    const memoryUrl = URL.createObjectURL(memoryBlob);

                    const detachedFile = new File([memoryBlob], file.name, {
                        type: 'application/pdf',
                        lastModified: file.lastModified
                    });

                    if (documents.some(document => document.id === docId)) continue;
                    newDocs.push({
                        id: docId,
                        stableId: stableId,
                        name: file.name,
                        fileUrl: memoryUrl,
                        file: detachedFile,
                        fileHandle: handle
                    });
                }

                if (newDocs.length) addDocumentsToWorkspace(newDocs);
                else if (handles.length === 1) {
                    const file = await (handles[0] as FileSystemFileHandle).getFile();
                    const existing = (await libraryDB.listAllFiles()).find(entry => entry.sourceFingerprint === createFileIdentity(file));
                    if (existing) {
                        focusDocument(existing.id);
                        setShowLibrary(false);
                    }
                }

                if (firstUnpermittedDoc) {
                    setPendingPermission(firstUnpermittedDoc);
                }
            } catch (err: any) {
                if (err.name === 'AbortError') return;
                console.error('Open file error:', err);
                fileInputRef.current?.click();
            }
        } else {
            fileInputRef.current?.click();
        }
    };

    // Imports detached File objects (no file handle): the <input> fallback and
    // the demo's bundled sample both come through here.
    const importFiles = async (files: File[]) => {
            const newDocs: DocumentEntry[] = [];
            let alreadyOpenId: string | null = null;

            for (const file of files) {
                const libraryEntry = await libraryDB.importFile(file, pendingImportFolderRef.current);
                const docId = libraryEntry.id;
                const stableId = await computeStableIdForFile(file);

                useSaveStore.getState().setNeedsUserAction(docId, { reason: 'no-handle' });

                const existingRecord = await localFileDB.getLocalFile(docId);
                const now = Date.now();
                if (existingRecord) {
                    await localFileDB.updateLocalFile(docId, { pdfFingerprint: stableId, displayName: file.name });
                } else {
                    await localFileDB.createLocalFile({
                        localFileId: docId,
                        pdfFingerprint: stableId,
                        displayName: file.name,
                        autosaveEnabled: false,
                        autosaveIntervalSec: 10,
                        createdAt: now,
                        updatedAt: now,
                    });
                }

                if (documents.some(document => document.id === docId)) {
                    alreadyOpenId = docId;
                    continue;
                }
                newDocs.push({
                    id: docId,
                    stableId: stableId,
                    name: file.name,
                    fileUrl: URL.createObjectURL(file),
                    file: file
                });
            }

            if (newDocs.length) addDocumentsToWorkspace(newDocs);
            else if (alreadyOpenId) {
                focusDocument(alreadyOpenId);
                setShowLibrary(false);
            }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const files = [...e.target.files];
        e.target.value = '';
        await importFiles(files);
    };



    const removeDocument = (id: string) => {
        useSaveStore.getState().clearDoc(id);
        setDocuments(prev => prev.filter(d => d.id !== id));
        const nextLayout = removeTab(workspaceLayout, id, 'pane-root');
        setWorkspaceLayout(nextLayout);
        if (focusedDocId === id) setFocusedDocId(visibleTabIds(nextLayout)[0] ?? null);
    };

    const handleRefreshDocument = async (docId: string) => {
        const doc = documents.find(d => d.id === docId);
        if (!doc) return;

        // Try to get file handle from doc entry or from IDB
        let handle: FileSystemFileHandle | null = doc.fileHandle || null;

        if (!handle) {
            // Try to get it from IDB
            try {
                const localFile = await localFileDB.getLocalFile(docId);
                handle = localFile?.pdfFileHandle || null;
            } catch { }
        }

        if (!handle) {
            alert('Cannot refresh: No file handle available. The file was likely opened via drag-and-drop or file input without File System Access API support.');
            return;
        }

        try {
            // Try to read the file — this will throw if deleted/moved
            const file = await handle.getFile();
            const arrayBuffer = await file.arrayBuffer();
            const memoryBlob = new Blob([arrayBuffer], { type: 'application/pdf' });
            const newUrl = URL.createObjectURL(memoryBlob);

            const detachedFile = new File([memoryBlob], file.name, {
                type: 'application/pdf',
                lastModified: file.lastModified
            });

            // Revoke old URL
            if (doc.fileUrl) {
                URL.revokeObjectURL(doc.fileUrl);
            }

            // Update the document entry with fresh file data
            setDocuments(prev => prev.map(d =>
                d.id === docId
                    ? { ...d, fileUrl: newUrl, file: detachedFile, name: file.name }
                    : d
            ));

            // Clear the pristine PDF cache so flatten uses the fresh file
            // Dispatch a custom event that PDFViewer can listen to for reload
            window.dispatchEvent(new CustomEvent('pdf-refresh', {
                detail: { docId, fileUrl: newUrl }
            }));

            console.log('[Dashboard] Refreshed document:', file.name);
        } catch (err: any) {
            // File was deleted or moved
            if (err.name === 'NotFoundError' || err.name === 'NotAllowedError') {
                const action = confirm(
                    `The file "${doc.name}" could not be found. It may have been deleted or moved.\n\nWould you like to close this tab?`
                );
                if (action) {
                    removeDocument(docId);
                }
            } else {
                console.error('[Dashboard] Refresh failed:', err);
                alert(`Failed to refresh: ${err.message}`);
            }
        }
    };

    const handleLoadJSON = async (docId: string) => {
        const doc = documents.find(d => d.id === docId);
        if (!doc) return;

        if (!('showOpenFilePicker' in window)) {
            alert('Your browser does not support the File System Access API needed for this feature.');
            return;
        }

        try {
            const [handle] = await (window as any).showOpenFilePicker({
                types: [{ description: 'JSON Annotations', accept: { 'application/json': ['.json'] } }],
                multiple: false
            });

            const file = await handle.getFile();
            const text = await file.text();

            let data: any;
            try {
                data = JSON.parse(text);
            } catch {
                alert('Invalid JSON file.');
                return;
            }

            // Robust check for objects array
            const annotations = Array.isArray(data) ? data : (data.objects || []);
            if (!Array.isArray(annotations)) {
                alert('Invalid JSON structure.');
                return;
            }

            // Conflict Check
            const existingBackup = await localFileDB.getBackup(docId);
            if (existingBackup) {
                const proceed = window.confirm(
                    "This document already has saved annotations in the database.\n\n" +
                    "Do you want to REPLACE them with the loaded JSON?\n" +
                    "(The previous annotations will be overwritten.)"
                );
                if (!proceed) return;
            }

            // 1. Update/Create Metadata in IDB
            const existingRecord = await localFileDB.getLocalFile(docId);
            const now = Date.now();

            if (existingRecord) {
                await localFileDB.updateLocalFile(docId, {
                    jsonFileHandle: handle,
                    updatedAt: now,
                    displayName: file.name.replace('.json', '')
                });
            } else {
                await localFileDB.createLocalFile({
                    localFileId: docId,
                    pdfFingerprint: doc.stableId,
                    displayName: doc.name,
                    createdAt: now,
                    updatedAt: now,
                    autosaveEnabled: true, // Auto-enable on manual load? Sure.
                    autosaveIntervalSec: 10,
                    jsonFileHandle: handle
                } as any);
            }

            // 2. Persist Payload to IDB (Instant Save)
            await localFileDB.saveBackup({
                localFileId: docId,
                annotationsJSON: {
                    schemaVersion: 1,
                    editorVersion: '1.0.0',
                    pageCount: 1,
                    objects: annotations,
                    createdAt: now,
                    updatedAt: now
                },
                updatedAt: now
            });

            // 3. Update Runtime (Notify Editor)
            window.dispatchEvent(new CustomEvent('pdf-editor:load-json', {
                detail: { docId, annotations: annotations }
            }));

            // Notify user
            // toast?
            console.log('[Dashboard] JSON loaded and saved to IDB.');

        } catch (err: any) {
            if (err.name !== 'AbortError') {
                console.error('Failed to load JSON:', err);
                alert('Failed to load JSON.');
            }
        }
    };

    const [showAIChat, setShowAIChat] = useState(false);
    // The demo opens on its showcase; the normal build never has one.
    const [showShowcase, setShowShowcase] = useState(IS_DEMO);
    return (
        <div className={cn(
            "flex h-screen w-screen overflow-hidden flex-col bg-ground text-text",
        )}>
            <Header
                onOpenPDF={() => void handleOpenPDF()}
                documents={documents}
                onRemoveDocument={removeDocument}
                onRefreshDocument={handleRefreshDocument}
                onLoadJSON={handleLoadJSON}
                showAIChat={showAIChat}
                onToggleAIChat={() => setShowAIChat(!showAIChat)}
                onFocusDocument={focusDocument}
                onShowLibrary={() => { setShowShowcase(false); setShowLibrary(true); }}
            />
            {DemoBanner && <Suspense fallback={null}><DemoBanner /></Suspense>}

            <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={handleFileChange}
            />

            <PermissionPrompt
                isOpen={pendingPermission !== null}
                fileName={pendingPermission?.fileName || ''}
                onAllow={handlePermissionAllow}
                onDeny={handlePermissionDeny}
            />

            <div className="flex-1 flex overflow-hidden relative">
                <Sidebar
                    replicateToolbar={replicateToolbar}
                    setReplicateToolbar={setReplicateToolbar}
                />


                <div className="flex-1 overflow-hidden relative bg-ground flex">
                    <div className="flex-1 overflow-hidden relative">
                        {DemoShowcase && showShowcase ? (
                            <Suspense fallback={null}>
                                <DemoShowcase
                                    onOpenSample={async (file) => { await importFiles([file]); setShowShowcase(false); }}
                                    onOpenOwn={() => { setShowShowcase(false); void handleOpenPDF(); }}
                                    onSkip={() => { setShowShowcase(false); setShowLibrary(true); }}
                                />
                            </Suspense>
                        ) : showLibrary ? (
                            <LibraryGrid onOpen={handleOpenLibraryFile} onAddReferences={(folderId) => void handleOpenPDF(folderId)} />
                        ) : documents.length === 0 ? (
                            <EmptyState
                                className="h-full bg-ground"
                                art={<PaperStackArt size={112} />}
                                title="Open a mathematical document to get started"
                                description="Files stay on this machine. Press Ctrl+K at any time to find a command."
                                action={<Button onClick={() => void handleOpenPDF()} variant="primary">Open and add PDF</Button>}
                            />
                        ) : (
                            <DocumentsGrid
                                documents={documents}
                                layout={workspaceLayout}
                                setLayout={setWorkspaceLayout}
                                replicateToolbar={replicateToolbar}
                                onFocusDocument={focusDocument}
                            />
                        )}
                    </div>
                    {/* Render AI Chat Sidebar here as a sibling */}
                    {AIChatSidebar && showAIChat && (
                    <Suspense fallback={null}>
                    <AIChatSidebar
                        isOpen={showAIChat}
                        onClose={() => setShowAIChat(false)}
                        documents={documents}
                        onFocusDocument={focusDocument}
                        variant="embedded"
                    />
                    </Suspense>
                    )}
                </div>
            </div>

            <StatusBar documents={documents} paneCount={countPanes(workspaceLayout)} />
            <ToastContainer />
            <CommandLayer />
            <WorkspaceCommands
                documents={documents}
                focusedDocId={focusedDocId}
                assistantOpen={showAIChat}
                onOpenPdf={() => void handleOpenPDF()}
                onShowLibrary={() => setShowLibrary(true)}
                onToggleAssistant={() => setShowAIChat(value => !value)}
                onCloseDocument={removeDocument}
                onFocusDocument={focusDocument}
            />
            {!showShowcase && <CoachMarks />}
        </div>
    );
}
