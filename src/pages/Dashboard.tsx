
import { useState, useRef, useEffect } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { DocumentsGrid } from '@/components/DocumentsGrid';
import { Header } from '@/components/Header';
import { PermissionPrompt } from '@/components/PermissionPrompt';
import { AIChatSidebar } from '@/components/AIChatSidebar';
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

import { ToastContainer } from '@/components/ui/Toast';

// Pending permission request info
interface PendingPermission {
    docId: string;
    fileName: string;
    handle: FileSystemFileHandle;
}

export default function Dashboard() {
    const [documents, setDocuments] = useState<DocumentEntry[]>([]);
    const [replicateToolbar, setReplicateToolbar] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Permission prompt state
    const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);

    const { isDarkMode } = useAppStore();

    // Global Unsaved Changes Warning
    const isDirtyByPdf = useSaveStore((state: SaveStoreState) => state.isDirtyByPdf);

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

    const layout = documents.length > 0 ? documents.length : 1;

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

    const handleOpenPDF = async () => {
        const remainingSlots = 4 - documents.length;
        if (remainingSlots <= 0) return;

        if ('showOpenFilePicker' in window) {
            try {
                const handles = await (window as any).showOpenFilePicker({
                    multiple: remainingSlots > 1,
                    types: [{ description: 'PDF Documents', accept: { 'application/pdf': ['.pdf'] } }],
                });

                const newDocs: DocumentEntry[] = [];
                let firstUnpermittedDoc: PendingPermission | null = null;

                for (let i = 0; i < handles.length && i < remainingSlots; i++) {
                    const handle = handles[i] as FileSystemFileHandle;
                    const file = await handle.getFile();
                    const docId = crypto.randomUUID();
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

                    newDocs.push({
                        id: docId,
                        stableId: stableId,
                        name: file.name,
                        fileUrl: memoryUrl,
                        file: detachedFile,
                        fileHandle: handle
                    });
                }

                setDocuments(prev => [...prev, ...newDocs]);

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

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const remainingSlots = 4 - documents.length;
            if (remainingSlots <= 0) return;

            const newDocs: DocumentEntry[] = [];

            for (let i = 0; i < e.target.files.length && i < remainingSlots; i++) {
                const file = e.target.files[i];
                const docId = crypto.randomUUID();
                const stableId = await computeStableIdForFile(file);

                useSaveStore.getState().setNeedsUserAction(docId, { reason: 'no-handle' });

                newDocs.push({
                    id: docId,
                    stableId: stableId,
                    name: file.name,
                    fileUrl: URL.createObjectURL(file),
                    file: file
                });
            }

            setDocuments(prev => [...prev, ...newDocs]);
            e.target.value = '';
        }
    };



    const removeDocument = (id: string) => {
        useSaveStore.getState().clearDoc(id);
        setDocuments(prev => prev.filter(d => d.id !== id));
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

    return (
        <div className={cn(
            "flex h-screen w-screen overflow-hidden flex-col",
            isDarkMode ? 'dark bg-gray-900 text-white' : 'bg-white text-gray-900'
        )}>
            <Header
                onOpenPDF={handleOpenPDF}
                documents={documents}
                onRemoveDocument={removeDocument}
                onRefreshDocument={handleRefreshDocument}
                onLoadJSON={handleLoadJSON}
                showAIChat={showAIChat}
                onToggleAIChat={() => setShowAIChat(!showAIChat)}
            />

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


                <div className="flex-1 overflow-hidden relative bg-white dark:bg-gray-950 flex">
                    <div className="flex-1 overflow-hidden relative">
                        {documents.length === 0 ? (
                            <div className={cn("flex flex-col items-center justify-center h-full text-gray-400 gap-4", isDarkMode ? 'dark bg-gray-900 text-white' : 'bg-white text-gray-900')}>
                                <p className="text-lg">Open a PDF to get started</p>
                                <div className="flex gap-4">
                                    <button
                                        onClick={handleOpenPDF}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                                    >
                                        Open Local PDF
                                    </button>

                                </div>
                            </div>
                        ) : (
                            <DocumentsGrid
                                documents={documents}
                                layout={layout}
                                replicateToolbar={replicateToolbar}
                            />
                        )}
                    </div>
                    {/* Render AI Chat Sidebar here as a sibling */}
                    <AIChatSidebar
                        isOpen={showAIChat}
                        onClose={() => setShowAIChat(false)}
                        variant="embedded"
                    />
                </div>
            </div>

            <ToastContainer />
        </div>
    );
}
