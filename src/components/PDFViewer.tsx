import { useEffect, useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { useAppStore, type SearchMatchHighlight } from '@/lib/store';
import { saveManager } from '@/lib/saving/save-manager';
import type { EditorFile, AnnotationData } from '@/types/editor-types';
import { annotationStorage } from '@/lib/annotations/storage';
import { operationManager } from '@/lib/annotations/operation-manager';
import {
    createAddOperation,
    createAddPageOperation,
    createBatchOperation,
    createDeleteOperation,
    createDeletePageOperation,
    createMovePageOperation,
    createRotatePageOperation,
    createUpdateOperation,
    createAddNoteOperation,
    createDeleteNoteOperation,
    createUpdateNoteOperation,
} from '@/lib/annotations/operations';
import { applyOperationToAnnotations } from '@/core/annotations/apply';
import { AnnotationCanvas } from './AnnotationCanvas';
import { MathModal } from './MathModal';
import type { Annotation, HighlightAnnotation, Operation } from '@/lib/annotations/models';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractAnnotationData, embedAnnotations } from '@/lib/pdf-data-manager';
import { localFileDB } from '@/lib/storage/local-file-db';
import { useOcr } from '@/hooks/useOcr';
import { OcrTextLayer } from './OcrTextLayer';
import type { OcrPageResult } from '@/lib/ocr/client-ocr';
import { localSearchRegistry } from '@/lib/search/local-search';
import type { PageDocument, PageRecord } from '@/core/pages/models';
import {
    annotationsForExistingPages,
    applyOperationToPageDocument,
    attachAnnotationsToPageIds,
    createPageDocument,
    pageDocumentRevision,
    rotateBy,
} from '@/core/pages/document';
import {
    createInitialPageDocument,
    describePdfSource,
    downloadPdf,
    exportPageRecords,
    materializePageDocument,
} from '@/lib/pages/pdf-pages';
import { pageWorkspaceStorage } from '@/lib/pages/storage';
import { PageOrganizer } from './PageOrganizer';
import { rotateAnnotation } from '@/core/pages/annotations';
import {
    addAnchorToNote,
    applyOperationToNotes,
    createDocumentNote,
    createNoteAnchor,
    migrateHighlightNotes,
    notesForHighlights,
    removeAnchorFromNote,
    synchronizeNoteAnchors,
} from '@/core/notes/notes';
import type { DocumentNote, NoteAnchor } from '@/core/notes/models';
import { NotesPanel } from './NotesPanel';
import { DocumentDock } from './DocumentDock';
import { DocumentPanelBar } from './DocumentPanelBar';
import { readDockTab, type DockTab } from '@/lib/ui/dock';
import { OutlinePanel } from './OutlinePanel';
import { useRegisterCommands } from '@/lib/commands/registry';
import { libraryDB } from '@/lib/storage/library-db';

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface PDFViewerProps {
    file: File | null;
    fileUrl?: string;
    fileId: string;
    stableId: string;
    parentFolderId?: string;
    role?: 'owner' | 'editor' | 'viewer';
    displayName?: string; // Name for cloud files
    annotationsUrl?: string; // URL to fetch annotations from (for shared links)
    shareId?: string;
    linkToken?: string;
}

export function PDFViewer({ file, fileUrl, fileId, stableId, parentFolderId, role = 'owner', displayName, annotationsUrl }: PDFViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    const [renderedDocumentRevision, setRenderedDocumentRevision] = useState('');
    const [pageDocument, setPageDocument] = useState<PageDocument | null>(null);
    const pageDocumentRef = useRef<PageDocument | null>(null);
    const workingPdfBytesRef = useRef<Uint8Array | null>(null);
    const pageRenderRevisionRef = useRef(0);
    const [showPageOrganizer, setShowPageOrganizer] = useState(false);
    // The right-hand dock: null when closed, otherwise the visible tab.
    const [dockTab, setDockTab] = useState<DockTab | null>(null);
    const [focusedHighlightId, setFocusedHighlightId] = useState<string | null>(null);
    const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const annotationsRef = useRef<Annotation[]>([]);
    const [notes, setNotes] = useState<DocumentNote[]>([]);
    const notesRef = useRef<DocumentNote[]>([]);
    const setLoadedAnnotations = useCallback((loaded: Annotation[], loadedNotes: DocumentNote[] = notesRef.current) => {
        const document = pageDocumentRef.current;
        const anchored = document ? attachAnnotationsToPageIds(loaded, document) : loaded;
        const migrated = migrateHighlightNotes(anchored);
        const noteMap = new Map(loadedNotes.map(note => [note.id, note]));
        for (const note of migrated.notes) if (!noteMap.has(note.id)) noteMap.set(note.id, note);
        const nextNotes = synchronizeNoteAnchors([...noteMap.values()], migrated.annotations);
        annotationsRef.current = migrated.annotations;
        notesRef.current = nextNotes;
        setAnnotations(migrated.annotations);
        setNotes(nextNotes);
        setActiveNoteId(current => current && nextNotes.some(note => note.id === current) ? current : null);
        void annotationStorage.saveSidecar(stableId, migrated.annotations, nextNotes);
    }, [stableId]);
    const [showMathModal, setShowMathModal] = useState(false);
    // Throttled save ref
    const saveTimeoutRef = useRef<number | undefined>(undefined);
    const readingProgressTimeoutRef = useRef<number | undefined>(undefined);
    const restoredReadingPositionRef = useRef(false);
    // Track page count for payload provider to avoid dependency cycles
    const pageCountRef = useRef(0);

    const {
        // isDarkMode moved to ThemeProvider
        annotationMode,
        setAnnotationMode,
        setAwaitingMathPlacement,
        editingMathAnnotation,
        setEditingMathAnnotation,
        isMathModalOpen,
        setMathModalOpen,
        setIsDirty,
        scale,
        setScale
    } = useDocumentStore(state => state);

    // OCR Hook (Cloud Only)
    // We only trigger OCR if we have a stable docId and it is a cloud file (parentFolderId exists)
    // stableId from props is usually the hash or UUID. For cloud, fileId is the Firestore Doc ID.
    // The hook expects the Doc ID.
    // Suppress unused warning

    // Client-side OCR Hook (Local Only)
    const { startOcr, pages: ocrPages, status: _clientOcrStatus } = useOcr(fileId, pdfDoc);

    // Auto-start Client OCR / Global Store Sync
    useEffect(() => {
        if (!parentFolderId && fileId && pdfDoc) {
            // Keyword search reads only PDF.js native text. OCR remains a
            // separate viewing/assistant capability and never enters search.
            const fingerprint = pdfDoc.fingerprints?.[0] || fileId;
            const disposeSearchRegistration = localSearchRegistry.register(
                fileId,
                fingerprint,
                renderedDocumentRevision || `pdf:${pdfDoc.numPages}`,
                pdfDoc,
            );
            window.dispatchEvent(new CustomEvent('pdf-loaded', {
                detail: { fileId, fingerprint },
            }));
            
            startOcr();
            
            return () => {
                disposeSearchRegistration();
            };
        }
    }, [fileId, parentFolderId, pdfDoc, renderedDocumentRevision, startOcr]);

    // Use displayName for cloud files, fallback to local logic
    const fileName = displayName || file?.name || 'document.pdf';

    // ... (Zoom handlers unchanged) ...
    // Wheel / Pinch Zoom Handler with Zoom-to-Point
    const [pageDimensions, setPageDimensions] = useState<{ [key: number]: { width: number, height: number } }>({});
    const zoomTargetRef = useRef<{ ratioX: number, ratioY: number, mouseX: number, mouseY: number } | null>(null);

    useEffect(() => {
        if (zoomTargetRef.current && containerRef.current) {
            const { ratioX, ratioY, mouseX, mouseY } = zoomTargetRef.current;
            const container = containerRef.current;
            container.scrollLeft = (ratioX * scale) - mouseX;
            container.scrollTop = (ratioY * scale) - mouseY;
            zoomTargetRef.current = null;
        }
    }, [scale]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const onWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();

                const rect = container.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                const contentX = container.scrollLeft + mouseX;
                const contentY = container.scrollTop + mouseY;

                const ratioX = contentX / scale;
                const ratioY = contentY / scale;

                const factor = e.deltaY < 0 ? 1.1 : 0.9;
                const newScale = Math.min(Math.max(0.5, scale * factor), 5.0);

                if (newScale === scale) return;

                zoomTargetRef.current = { ratioX, ratioY, mouseX, mouseY };
                setScale(newScale);
            }
        };

        container.addEventListener('wheel', onWheel, { passive: false });
        return () => container.removeEventListener('wheel', onWheel);
    }, [scale, setScale]);

    // Math Modal Effects
    const isFirstMountForMath = useRef(true);

    useEffect(() => {
        setMathModalOpen(false);
        setEditingMathAnnotation(null);
    }, []);

    useEffect(() => {
        if (isFirstMountForMath.current) return;
        if (isMathModalOpen) setShowMathModal(true);
    }, [isMathModalOpen]);

    useEffect(() => {
        if (isFirstMountForMath.current) {
            isFirstMountForMath.current = false;
            return;
        }
        if (editingMathAnnotation) setShowMathModal(true);
    }, [editingMathAnnotation]);

    const loadSource = useCallback(
        (sourceId: string) => pageWorkspaceStorage.loadSource(stableId, sourceId),
        [stableId],
    );

    const displayPageDocument = useCallback(async (document: PageDocument) => {
        const revision = ++pageRenderRevisionRef.current;
        const bytes = await materializePageDocument(document, loadSource);
        const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
        const doc = await loadingTask.promise;
        if (revision !== pageRenderRevisionRef.current) {
            await doc.destroy();
            return;
        }

        workingPdfBytesRef.current = bytes;
        setPdfDoc(previous => {
            if (previous) void previous.destroy();
            return doc;
        });
        pageCountRef.current = document.pages.length;
        setRenderedDocumentRevision(pageDocumentRevision(document));

        const dims: { [key: number]: { width: number, height: number } } = {};
        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
            const page = await doc.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1 });
            dims[pageNumber] = { width: viewport.width, height: viewport.height };
        }
        if (revision === pageRenderRevisionRef.current) setPageDimensions(dims);
    }, [loadSource]);

    const updatePageDocument = useCallback(async (document: PageDocument) => {
        pageDocumentRef.current = document;
        setPageDocument(document);
        await pageWorkspaceStorage.saveDocument(stableId, document);
        await displayPageDocument(document);
    }, [displayPageDocument, stableId]);

    // File Loading
    useEffect(() => {
        if (!file && !fileUrl) return;
        let mounted = true;
        const loadPdf = async () => {
            try {
                const bytes = file
                    ? new Uint8Array(await file.arrayBuffer())
                    : new Uint8Array(await (await fetch(fileUrl!)).arrayBuffer());
                if (!mounted) return;

                let document = await pageWorkspaceStorage.loadDocument(stableId);
                if (!document) {
                    await pageWorkspaceStorage.saveSource(stableId, 'original', bytes);
                    document = await createInitialPageDocument(bytes);
                    await pageWorkspaceStorage.saveDocument(stableId, document);
                } else if (!await pageWorkspaceStorage.loadSource(stableId, 'original')) {
                    await pageWorkspaceStorage.saveSource(stableId, 'original', bytes);
                }
                if (!mounted) return;
                pageDocumentRef.current = document;
                setPageDocument(document);
                setLoadedAnnotations(annotationsRef.current);
                await displayPageDocument(document);

            } catch (error) {
                console.error('Error loading PDF:', error);
            }
        };
        loadPdf();
        return () => { mounted = false; };
    }, [displayPageDocument, file, fileUrl, fileId, stableId]);

    // ------------------------------------------------------------------------
    // REAL-TIME COLLABORATION SETUP (REMOVED)
    // ------------------------------------------------------------------------

    // Load Annotations (Legacy/API)
    useEffect(() => {
        let mounted = true;
        const loadAnnotations = async () => {
            console.log('[PDFViewer] Loading annotations logic for:', stableId);

            // SHARED LINK with annotationsUrl - load annotations directly from URL
            if (annotationsUrl && !parentFolderId) {
                try {
                    console.log('[PDFViewer] Loading annotations from shared URL');
                    const response = await fetch(annotationsUrl);
                    if (response.ok) {
                        const data = await response.json();
                        const annots = Array.isArray(data) ? data : (data.objects || data.annotations || []);
                        if (Array.isArray(annots) && mounted) {
                            console.log('[PDFViewer] Loaded annotations from URL:', annots.length);
                            setLoadedAnnotations(annots, Array.isArray(data.notes) ? data.notes : []);
                        }
                    }
                } catch (e) {
                    console.warn('[PDFViewer] Failed to load annotations from URL:', e);
                }
                return;
            }

            if (parentFolderId) {
                // Also try loading from annotationsUrl if provided (for shared links)
                if (annotationsUrl) {
                    try {
                        console.log('[PDFViewer] Loading annotations from shared URL (cloud fallback)');
                        const response = await fetch(annotationsUrl);
                        if (response.ok) {
                            const data = await response.json();
                            const annots = Array.isArray(data) ? data : (data.objects || data.annotations || []);
                            if (Array.isArray(annots) && mounted) {
                                console.log('[PDFViewer] Loaded annotations from URL:', annots.length);
                                setLoadedAnnotations(annots, Array.isArray(data.notes) ? data.notes : []);
                            }
                        }
                    } catch (e) {
                        console.warn('[PDFViewer] Failed to load annotations from URL:', e);
                    }
                    return;
                }
            }

            // LEGACY / LOCAL LOGIC
            // Only run if NOT cloud (or if fallback needed, but let's keep clean separation)
            if (parentFolderId) return;

            // ... (Existing Local Logic) ...
            // 0. Remote Source (Cloud) handled above or skipped for local
            {
                // LOCAL FILE: 
                // 1. Check for Associated JSON File (Highest Priority)
                try {
                    const localFile = await localFileDB.getLocalFile(fileId);
                    if (localFile?.jsonFileHandle) {
                        try {
                            const fileReq = await localFile.jsonFileHandle.getFile();
                            const text = await fileReq.text();
                            const data = JSON.parse(text);
                            // Support both raw array and AnnotationData wrapper
                            const annots = Array.isArray(data) ? data : data.objects;

                            if (Array.isArray(annots)) {
                                console.log('[PDFViewer] Loaded from associated JSON file:', annots.length);
                                if (mounted) {
                                    setLoadedAnnotations(annots, Array.isArray(data.notes) ? data.notes : []);
                                }
                                return;
                            }
                        } catch (err) {
                            console.warn('[PDFViewer] Failed to read associated JSON file (permission or parse error):', err);
                            // Fallthrough to backup
                        }
                    }

                    // Check Flatten Reminder
                    if (localFile) {
                        const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
                        const lastFlatten = localFile.lastFlattenSavedAt || 0;
                        if (Date.now() - lastFlatten > FIVE_DAYS_MS && lastFlatten > 0) {
                            // Simple alert or custom toast
                            setTimeout(() => {
                                if (!mounted) return;
                                const confirmExport = window.confirm(
                                    "⚠️ Reminder: You haven't exported a Flattened PDF in 5 days.\n\n" +
                                    "It is recommended to save a permanent copy.\n\n" +
                                    "Do you want to export now?"
                                );
                                if (confirmExport) {
                                    saveManager.saveDoc(fileId, { forcePicker: true, flatten: true });
                                }
                            }, 2000);
                        }
                    }
                } catch (e) {
                    console.error('[PDFViewer] Error checking local file DB:', e);
                }

                // 2. Check Crash Recovery / Backup
                try {
                    const backup = await localFileDB.getBackup(fileId);
                    if (backup) {
                        console.log('[PDFViewer] Recovered backup from:', new Date(backup.updatedAt).toISOString());
                        if (backup.annotationsJSON && Array.isArray(backup.annotationsJSON.objects)) {
                            if (mounted) setLoadedAnnotations(backup.annotationsJSON.objects, backup.annotationsJSON.notes ?? []);
                            return;
                        }
                    }
                } catch (e) {
                    console.error('Backup check failed:', e);
                }
            }

            // 1. Try Embedded Data (Portable Source)
            if (file) {
                const embedded = await extractAnnotationData(file);
                if (!mounted) return;
                if (embedded) {
                    console.log('[PDFViewer] Loaded from embedded data:', embedded.annotations.length);
                    setLoadedAnnotations(embedded.annotations, embedded.notes);
                    return;
                }
            }

            // 2. Fallback to Sidecar (Local Source)
            const loaded = await annotationStorage.loadDocumentState(stableId);
            if (!mounted) return;
            if (loaded) {
                console.log('[PDFViewer] Sidecar found:', loaded.annotations.length, 'annotations');
                setLoadedAnnotations(loaded.annotations, loaded.notes);
            } else {
                console.log('[PDFViewer] No sidecar or embedded data found.');
                setLoadedAnnotations([], []);
            }
        };
        loadAnnotations();

        return () => {
            mounted = false;
        };
    }, [stableId, file, fileId, parentFolderId, setLoadedAnnotations]);

    // External JSON Load Event Listener
    useEffect(() => {
        const handleExternalLoad = (e: CustomEvent<{ docId: string, annotations: Annotation[], notes?: DocumentNote[] }>) => {
            if (e.detail.docId === fileId) {
                console.log('[PDFViewer] External JSON loaded:', e.detail.annotations.length);

                setLoadedAnnotations(e.detail.annotations, e.detail.notes ?? []);
                saveManager.markDirty(fileId);
            }
        };

        window.addEventListener('pdf-editor:load-json' as any, handleExternalLoad as any);
        return () => window.removeEventListener('pdf-editor:load-json' as any, handleExternalLoad as any);
    }, [fileId, stableId, setLoadedAnnotations]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            operationManager.clearHistory(fileId);
        };
    }, [fileId]);

    // Throttled Save Sidecar (Local cache only - SaveManager handles actual saves)
    const scheduleSidecarSave = useCallback((currentAnnotations = annotationsRef.current, currentNotes = notesRef.current) => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

        saveTimeoutRef.current = window.setTimeout(async () => {
            // Local Cache (Always) - this is just for crash recovery
            await annotationStorage.saveSidecar(stableId, currentAnnotations, currentNotes);
        }, 2000);

    }, [stableId, fileId, parentFolderId]);

    // Undo/redo commands update the same React projection used by the canvases.
    // Storage alone cannot do this because sidecars are persisted as a document snapshot.
    useEffect(() => operationManager.subscribe(fileId, operation => {
        const currentDocument = pageDocumentRef.current;
        const nextDocument = currentDocument
            ? applyOperationToPageDocument(currentDocument, operation)
            : null;
        if (currentDocument && nextDocument && nextDocument !== currentDocument) {
            void updatePageDocument(nextDocument);
        }
        setAnnotations(previous => {
            const operated = applyOperationToAnnotations(previous, operation);
            const next = nextDocument ? attachAnnotationsToPageIds(operated, nextDocument) : operated;
            annotationsRef.current = next;
            scheduleSidecarSave(next, notesRef.current);
            return next;
        });
        setNotes(previous => {
            const next = synchronizeNoteAnchors(applyOperationToNotes(previous, operation), annotationsRef.current);
            notesRef.current = next;
            scheduleSidecarSave(annotationsRef.current, next);
            return next;
        });
        saveManager.markDirty(fileId);
        setIsDirty(true);
    }), [fileId, scheduleSidecarSave, setIsDirty, updatePageDocument]);


    // PDF Generation (Smart Save: Embedded vs Flattened)
    const generatePdfBytes = useCallback(async (flatten: boolean = false): Promise<Uint8Array> => {
        const currentBytes = workingPdfBytesRef.current;
        if (!currentBytes || !pdfDoc) throw new Error("No file loaded");

        const pdfLibDoc = await PDFDocument.load(currentBytes);
        const currentDocument = pageDocumentRef.current;
        const visibleAnnotations = currentDocument
            ? attachAnnotationsToPageIds(annotationsForExistingPages(annotations, currentDocument), currentDocument)
            : annotations;

        if (flatten) {
            // FLATTENED EXPORT (Pixels)
            const totalPages = pdfLibDoc.getPageCount();
            const { renderPageAnnotationsToCanvas } = await import('@/lib/rendering/annotation-renderer');

            for (let i = 0; i < totalPages; i++) {
                const pageNum = i + 1;
                const pdfPage = pdfLibDoc.getPage(i);
                const { width, height } = pdfPage.getSize();

                const pageAnnotations = visibleAnnotations.filter(a => a.pageNum === pageNum);
                if (pageAnnotations.length === 0) continue;

                const exportScale = 2;
                const canvas = document.createElement('canvas');

                await renderPageAnnotationsToCanvas(canvas, pageAnnotations, { width, height }, exportScale);

                const pngBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
                if (!pngBlob) continue;

                const pngArrayBuffer = await pngBlob.arrayBuffer();
                const pngImage = await pdfLibDoc.embedPng(pngArrayBuffer);

                pdfPage.drawImage(pngImage, {
                    x: 0,
                    y: 0,
                    width: width,
                    height: height,
                    opacity: 1,
                });
            }
        } else {
            await embedAnnotations(pdfLibDoc, visibleAnnotations, notesRef.current);
        }

        return await pdfLibDoc.save();
    }, [pdfDoc, annotations]);

    // Ref for getBlob to access latest state
    const getBlobRef = useRef<(flatten?: boolean) => Promise<Blob>>(async () => new Blob());
    // Ref for current annotations to access in onSaveSuccess
    useEffect(() => {
        annotationsRef.current = annotations;
    }, [annotations]);

    useEffect(() => {
        getBlobRef.current = async (flatten: boolean = false) => {
            const bytes = await generatePdfBytes(flatten);
            console.log(`[SaveManager] Generated ${flatten ? 'FLATTENED' : 'EMBEDDED'} blob for`, fileId);
            return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
        };
    }, [generatePdfBytes, fileId]);

    // Register with SaveManager
    useEffect(() => {
        if (!fileId) return;
        let mounted = true;

        console.log('[PDFViewer] Register effect mounting for:', fileId);

        const editorFile: EditorFile = {
            kind: 'local',
            localFileId: fileId,
            pdfFingerprint: stableId,
            displayName: fileName,
        };

        const register = async () => {
            try {
                const { saveManager } = await import('@/lib/saving/save-manager');
                if (!mounted) return;

                console.log('[PDFViewer] Calling saveManager.registerFile');
                await saveManager.registerFile(editorFile);

                if (!mounted) {
                    saveManager.unregisterFile(editorFile);
                    return;
                }

                saveManager.setPayloadProvider(fileId, () => {
                    const currentAnnotations = annotationsRef.current;
                    const pageCount = pageCountRef.current;

                    const data: AnnotationData = {
                        schemaVersion: 2,
                        editorVersion: '1.0.0',
                        pageCount: pageCount > 0 ? pageCount : 1,
                        objects: currentAnnotations,
                        notes: notesRef.current,
                        pageDocument: pageDocumentRef.current ?? undefined,
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    };
                    return data;
                });
                saveManager.setPdfProvider(fileId, async () => {
                    const bytes = workingPdfBytesRef.current;
                    if (!bytes) throw new Error('PDF is not ready');
                    return bytes;
                });

                // Local files autosave to IndexedDB on the same schedule the
                // cloud path used to, so a crash never costs more than one interval.
                saveManager.enableAutosave(fileId);
            } catch (err) {
                console.error('[PDFViewer] Failed to register file:', err);
            }
        };

        register();

        return () => {
            console.log('[PDFViewer] Register effect cleanup (unmount)');
            mounted = false;
            // Introduce a small delay or check?
            // No, standard cleanup. SaveManager should handle quick re-reg.
            saveManager.unregisterFile(editorFile);
        };
    }, [fileId, fileName, parentFolderId, stableId, role]);


    // Annotation Handlers
    const commitAnnotationOperation = useCallback(async (operation: Operation) => {
        const nextAnnotations = applyOperationToAnnotations(annotationsRef.current, operation);
        const nextNotes = synchronizeNoteAnchors(applyOperationToNotes(notesRef.current, operation), nextAnnotations);
        annotationsRef.current = nextAnnotations;
        notesRef.current = nextNotes;
        setAnnotations(nextAnnotations);
        setNotes(nextNotes);
        scheduleSidecarSave(nextAnnotations, nextNotes);
        saveManager.markDirty(fileId);
        setIsDirty(true);
        await operationManager.addOperation(operation);
    }, [fileId, scheduleSidecarSave, setIsDirty]);

    const handleAnnotationSave = useCallback(async (annotation: Annotation) => {
        const page = pageDocumentRef.current?.pages[annotation.pageNum - 1];
        const anchored: Annotation = page ? { ...annotation, pageId: page.id } : annotation;
        const previous = annotationsRef.current.find(item => item.id === anchored.id);
        let operation = previous
            ? createUpdateOperation(anchored, previous, fileId)
            : createAddOperation(anchored, fileId);
        const activeNote = !previous && anchored.type === 'highlight'
            ? notesRef.current.find(note => note.id === activeNoteId)
            : undefined;
        if (activeNote && anchored.type === 'highlight') {
            const updatedNote = addAnchorToNote(activeNote, createNoteAnchor(anchored));
            operation = createBatchOperation([
                operation,
                createUpdateNoteOperation(updatedNote, activeNote, fileId),
            ], fileId);
        }
        await commitAnnotationOperation(operation);
        if (!previous && anchored.type === 'highlight') {
            setFocusedHighlightId(anchored.id);
            if (activeNote) setDockTab('notes');
        }
    }, [activeNoteId, commitAnnotationOperation, fileId]);

    const handleAnnotationDelete = useCallback(async (id: string) => {
        const annotation = annotationsRef.current.find(item => item.id === id);
        if (!annotation) return;
        const operations: Operation[] = [createDeleteOperation(annotation, fileId)];
        for (const note of notesRef.current) {
            if (note.anchors.some(anchor => anchor.highlightId === id)) {
                operations.push(createUpdateNoteOperation(removeAnchorFromNote(note, id), note, fileId));
            }
        }
        await commitAnnotationOperation(operations.length === 1 ? operations[0] : createBatchOperation(operations, fileId));
    }, [commitAnnotationOperation, fileId]);

    const handleAnnotationErase = useCallback(async (deletedIds: string[], created: Annotation[]) => {
        const operations: Operation[] = [];
        for (const id of deletedIds) {
            const annotation = annotationsRef.current.find(item => item.id === id);
            if (annotation) operations.push(createDeleteOperation(annotation, fileId));
        }
        const deleted = new Set(deletedIds);
        for (const note of notesRef.current) {
            const nextAnchors = note.anchors.filter(anchor => !deleted.has(anchor.highlightId));
            if (nextAnchors.length !== note.anchors.length) {
                operations.push(createUpdateNoteOperation({ ...note, anchors: nextAnchors, updatedAt: Date.now() }, note, fileId));
            }
        }
        for (const annotation of created) {
            const page = pageDocumentRef.current?.pages[annotation.pageNum - 1];
            operations.push(createAddOperation(page ? { ...annotation, pageId: page.id } : annotation, fileId));
        }
        if (operations.length > 0) {
            await commitAnnotationOperation(createBatchOperation(operations, fileId));
        }
    }, [commitAnnotationOperation, fileId]);

    const commitPageOperation = useCallback(async (operation: Operation) => {
        const current = pageDocumentRef.current;
        if (!current) return;
        const nextDocument = applyOperationToPageDocument(current, operation);
        if (nextDocument === current) return;
        const operatedAnnotations = applyOperationToAnnotations(annotationsRef.current, operation);
        const nextAnnotations = attachAnnotationsToPageIds(operatedAnnotations, nextDocument);
        annotationsRef.current = nextAnnotations;
        setAnnotations(nextAnnotations);
        const nextNotes = synchronizeNoteAnchors(applyOperationToNotes(notesRef.current, operation), nextAnnotations);
        notesRef.current = nextNotes;
        setNotes(nextNotes);
        scheduleSidecarSave(nextAnnotations, nextNotes);
        await updatePageDocument(nextDocument);
        saveManager.markDirty(fileId);
        setIsDirty(true);
        await operationManager.addOperation(operation);
    }, [fileId, scheduleSidecarSave, setIsDirty, updatePageDocument]);

    const handleAddBlankPage = useCallback(() => {
        const document = pageDocumentRef.current;
        if (!document) return;
        const reference = document.pages.at(-1);
        const page: PageRecord = {
            id: crypto.randomUUID(),
            kind: 'blank',
            width: reference?.width ?? 612,
            height: reference?.height ?? 792,
            rotation: 0,
        };
        void commitPageOperation(createAddPageOperation(page, document.pages.length, fileId));
    }, [commitPageOperation, fileId]);

    const handleDeletePages = useCallback((pageIds: string[]) => {
        const document = pageDocumentRef.current;
        if (!document || pageIds.length === 0 || pageIds.length >= document.pages.length) return;
        const ids = new Set(pageIds);
        const operations: Operation[] = [];
        document.pages.map((page, index) => ({ page, index })).reverse().forEach(({ page, index }) => {
            if (ids.has(page.id)) operations.push(createDeletePageOperation(page, index, fileId));
        });
        for (const annotation of annotationsRef.current) {
            if (annotation.pageId && ids.has(annotation.pageId)) {
                operations.push(createDeleteOperation(annotation, fileId));
            }
        }
        const deletedHighlightIds = new Set(
            annotationsRef.current.filter(annotation => annotation.type === 'highlight' && annotation.pageId && ids.has(annotation.pageId))
                .map(annotation => annotation.id),
        );
        for (const note of notesRef.current) {
            const nextAnchors = note.anchors.filter(anchor => !deletedHighlightIds.has(anchor.highlightId));
            if (nextAnchors.length !== note.anchors.length) {
                operations.push(createUpdateNoteOperation({ ...note, anchors: nextAnchors, updatedAt: Date.now() }, note, fileId));
            }
        }
        void commitPageOperation(createBatchOperation(operations, fileId));
    }, [commitPageOperation, fileId]);

    const handleMovePage = useCallback((pageId: string, toIndex: number) => {
        const document = pageDocumentRef.current;
        if (!document) return;
        const fromIndex = document.pages.findIndex(page => page.id === pageId);
        if (fromIndex < 0 || fromIndex === toIndex) return;
        void commitPageOperation(createMovePageOperation(pageId, fromIndex, toIndex, fileId));
    }, [commitPageOperation, fileId]);

    const handleRotatePages = useCallback((pageIds: string[], delta: 90 | -90) => {
        const document = pageDocumentRef.current;
        if (!document) return;
        const ids = new Set(pageIds);
        const operations = document.pages
            .filter(page => ids.has(page.id))
            .map(page => createRotatePageOperation(page.id, rotateBy(page.rotation, delta), page.rotation, fileId));
        for (const annotation of annotationsRef.current) {
            if (annotation.pageId && ids.has(annotation.pageId)) {
                operations.push(createUpdateOperation(rotateAnnotation(annotation, delta), annotation, fileId));
            }
        }
        if (operations.length) void commitPageOperation(createBatchOperation(operations, fileId));
    }, [commitPageOperation, fileId]);

    const handleMergePdf = useCallback(async (mergedFile: File) => {
        const document = pageDocumentRef.current;
        if (!document) return;
        try {
            const bytes = new Uint8Array(await mergedFile.arrayBuffer());
            const sourceId = crypto.randomUUID();
            const importedPages = await describePdfSource(bytes, sourceId);
            await pageWorkspaceStorage.saveSource(stableId, sourceId, bytes);
            const operations = importedPages.map((page, offset) =>
                createAddPageOperation(page, document.pages.length + offset, fileId));
            if (operations.length) await commitPageOperation(createBatchOperation(operations, fileId));
        } catch (error) {
            console.error('Could not merge PDF:', error);
        }
    }, [commitPageOperation, fileId, stableId]);

    const exportRecordsWithAnnotations = useCallback(async (pages: PageRecord[]) => {
        const bytes = await exportPageRecords(pages, loadSource);
        const selectedDocument = createPageDocument(pages);
        const selectedAnnotations = attachAnnotationsToPageIds(
            annotationsForExistingPages(annotationsRef.current, selectedDocument),
            selectedDocument,
        );
        if (!selectedAnnotations.length) return bytes;
        const selectedNotes = notesForHighlights(
            notesRef.current,
            new Set(selectedAnnotations.filter(annotation => annotation.type === 'highlight').map(annotation => annotation.id)),
        );
        const pdf = await PDFDocument.load(bytes);
        await embedAnnotations(pdf, selectedAnnotations, selectedNotes);
        return pdf.save();
    }, [loadSource]);

    const handleExtractPages = useCallback(async (pageIds: string[]) => {
        const document = pageDocumentRef.current;
        if (!document) return;
        const ids = new Set(pageIds);
        const selectedPages = document.pages.filter(page => ids.has(page.id));
        const bytes = await exportRecordsWithAnnotations(selectedPages);
        downloadPdf(bytes, `${fileName.replace(/\.pdf$/i, '')}-extract.pdf`);
    }, [exportRecordsWithAnnotations, fileName]);

    const handleSplitPdf = useCallback(async (afterPageId: string) => {
        const document = pageDocumentRef.current;
        if (!document) return;
        const splitIndex = document.pages.findIndex(page => page.id === afterPageId) + 1;
        if (splitIndex <= 0 || splitIndex >= document.pages.length) return;
        const baseName = fileName.replace(/\.pdf$/i, '');
        const [left, right] = await Promise.all([
            exportRecordsWithAnnotations(document.pages.slice(0, splitIndex)),
            exportRecordsWithAnnotations(document.pages.slice(splitIndex)),
        ]);
        downloadPdf(left, `${baseName}-part-1.pdf`);
        downloadPdf(right, `${baseName}-part-2.pdf`);
    }, [exportRecordsWithAnnotations, fileName]);

    const focusHighlight = useCallback((highlight: HighlightAnnotation) => {
        setFocusedHighlightId(highlight.id);
        setDockTab('notes');
        const pageElement = containerRef.current?.querySelector(`[data-page-id="${highlight.pageId ?? ''}"]`);
        pageElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, []);

    const handleCreateNote = useCallback(async () => {
        const note = createDocumentNote(crypto.randomUUID());
        await commitAnnotationOperation(createAddNoteOperation(note, fileId));
        setActiveNoteId(note.id);
        setDockTab('notes');
    }, [commitAnnotationOperation, fileId]);

    const handleNoteChange = useCallback(async (note: DocumentNote) => {
        const previous = notesRef.current.find(item => item.id === note.id);
        if (previous) await commitAnnotationOperation(createUpdateNoteOperation(note, previous, fileId));
    }, [commitAnnotationOperation, fileId]);

    const handleNoteDelete = useCallback(async (note: DocumentNote) => {
        await commitAnnotationOperation(createDeleteNoteOperation(note, fileId));
        setActiveNoteId(current => current === note.id ? null : current);
    }, [commitAnnotationOperation, fileId]);

    const handleAttachFocusedHighlight = useCallback(async () => {
        const note = notesRef.current.find(item => item.id === activeNoteId);
        const highlight = annotationsRef.current.find(
            (item): item is HighlightAnnotation => item.id === focusedHighlightId && item.type === 'highlight',
        );
        if (!note || !highlight) return;
        const updated = addAnchorToNote(note, createNoteAnchor(highlight));
        if (updated === note) return;
        const operations: Operation[] = notesRef.current.flatMap(item => {
            if (item.id === note.id || !item.anchors.some(anchor => anchor.highlightId === highlight.id)) return [];
            return [createUpdateNoteOperation(removeAnchorFromNote(item, highlight.id), item, fileId)];
        });
        operations.push(createUpdateNoteOperation(updated, note, fileId));
        await commitAnnotationOperation(operations.length === 1 ? operations[0] : createBatchOperation(operations, fileId));
    }, [activeNoteId, commitAnnotationOperation, fileId, focusedHighlightId]);

    const handleDetachNoteAnchor = useCallback(async (note: DocumentNote, highlightId: string) => {
        const updated = removeAnchorFromNote(note, highlightId);
        await commitAnnotationOperation(createUpdateNoteOperation(updated, note, fileId));
    }, [commitAnnotationOperation, fileId]);

    const focusNoteAnchor = useCallback((anchor: NoteAnchor) => {
        const highlight = annotationsRef.current.find(
            (item): item is HighlightAnnotation => item.id === anchor.highlightId && item.type === 'highlight',
        );
        if (highlight) focusHighlight(highlight);
    }, [focusHighlight]);

    const highlightColor = useCallback((highlightId: string) => {
        const highlight = annotationsRef.current.find(item => item.id === highlightId);
        return highlight?.style?.color;
    }, []);

    const toggleDock = useCallback((tab: DockTab) => {
        setDockTab(current => current === tab ? null : tab);
    }, []);

    const scrollToPageId = useCallback((pageId: string) => {
        const frame = containerRef.current?.querySelector<HTMLElement>(`[data-page-id="${pageId}"]`);
        frame?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (frame) {
            frame.classList.remove('focus-pulse');
            void frame.offsetWidth;
            frame.classList.add('focus-pulse');
        }
    }, []);

    // Document commands exist only while this document is the focused one.
    const isFocusedDocument = useAppStore(state => state.focusedDocId === fileId);
    const searchMatches = useAppStore(state => state.searchMatches);
    const searchHighlight = useAppStore(state => state.searchHighlight);
    const documentSearchMatches = isFocusedDocument
        ? searchMatches.filter(match => match.docId === fileId)
        : [];

    useRegisterCommands(`document:${fileId}`, [
        { id: 'document.panel', title: dockTab ? 'Hide side panel' : 'Show side panel', group: 'Document', shortcut: 'Mod+\\', allowInInput: true, keywords: ['dock', 'sidebar'], run: () => setDockTab(current => current ? null : readDockTab(stableId)) },
        { id: 'document.notes', title: dockTab === 'notes' ? 'Hide notes' : 'Show notes', group: 'Document', shortcut: 'Mod+Shift+N', allowInInput: true, keywords: ['annotations', 'panel'], run: () => toggleDock('notes') },
        { id: 'document.outline', title: dockTab === 'outline' ? 'Hide outline' : 'Show outline', group: 'Document', shortcut: 'Mod+Shift+O', allowInInput: true, keywords: ['contents', 'toc', 'chapters'], run: () => toggleDock('outline') },
        { id: 'document.new-note', title: 'New note', group: 'Document', keywords: ['write', 'comment'], run: () => void handleCreateNote() },
        { id: 'document.pages', title: 'Organise pages', group: 'Document', shortcut: 'Mod+Shift+P', enabled: role !== 'viewer', keywords: ['reorder', 'rotate', 'split', 'merge', 'extract', 'delete page'], run: () => setShowPageOrganizer(true) },
    ], isFocusedDocument);

    const handlePagesScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
        if (readingProgressTimeoutRef.current) clearTimeout(readingProgressTimeoutRef.current);
        const scrollContainer = event.currentTarget;
        readingProgressTimeoutRef.current = window.setTimeout(() => {
            const center = scrollContainer.getBoundingClientRect().top + scrollContainer.clientHeight / 2;
            const pageElements = [...scrollContainer.querySelectorAll<HTMLElement>('[data-page-id]')];
            const nearest = pageElements.reduce<{ element: HTMLElement; distance: number } | null>((best, element) => {
                const bounds = element.getBoundingClientRect();
                const distance = Math.abs(bounds.top + bounds.height / 2 - center);
                return !best || distance < best.distance ? { element, distance } : best;
            }, null);
            const pageNumber = nearest?.element.querySelector<HTMLElement>('[data-page-num]')?.dataset.pageNum;
            if (pageNumber) void libraryDB.updateFileMetadata(fileId, { lastReadPage: Number(pageNumber) });
        }, 400);
    }, [fileId]);

    useEffect(() => {
        if (restoredReadingPositionRef.current || !pageDocument?.pages.length) return;
        restoredReadingPositionRef.current = true;
        void libraryDB.getFile(fileId).then(entry => {
            const page = entry?.lastReadPage;
            if (!page || page <= 1) return;
            requestAnimationFrame(() => {
                const pageId = pageDocument.pages[Math.min(page, pageDocument.pages.length) - 1]?.id;
                containerRef.current?.querySelector(`[data-page-id="${pageId}"]`)
                    ?.scrollIntoView({ block: 'start' });
            });
        });
    }, [fileId, pageDocument]);

    // ... (Remainder unchanged) ...


    // ... Render logic (Pages) ...
    return (
        <div className="relative flex h-full flex-1 flex-col bg-ground">
            <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <DocumentPanelBar
                dockTab={dockTab}
                onToggle={toggleDock}
                noteCount={notes.length}
                pageCount={pageDocument?.pages.length ?? 0}
                onOrganisePages={() => setShowPageOrganizer(true)}
                canOrganise={role !== 'viewer'}
            />
            <div
                ref={containerRef}
                data-pdf-scroll-container={fileId}
                className="flex h-full min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto p-4"
                onScroll={handlePagesScroll}
            >
                {(pageDocument?.pages ?? []).map((page, index) => {
                    const pageNum = index + 1;
                    return (
                    <PDFPage
                        key={`${fileId}-page-${page.id}`}
                        documentId={fileId}
                        pageId={page.id}
                        pageNum={pageNum}
                        pdfDoc={pdfDoc}
                        scale={scale}
                        annotations={annotations.filter(a => a.pageId ? a.pageId === page.id : a.pageNum === pageNum)}
                        onAnnotationSave={handleAnnotationSave}
                        onAnnotationDelete={handleAnnotationDelete}
                        onAnnotationErase={handleAnnotationErase}
                        dimensions={pageDimensions[pageNum]}
                        ocrData={ocrPages[pageNum]}
                        focusedHighlightId={focusedHighlightId}
                        onHighlightFocus={(id) => {
                            const highlight = annotationsRef.current.find(
                                (annotation): annotation is HighlightAnnotation => annotation.id === id && annotation.type === 'highlight',
                            );
                            if (highlight) focusHighlight(highlight);
                        }}
                    />
                    );
                })}
            </div>
            {documentSearchMatches.length > 0 && (
                <div className="pointer-events-none absolute bottom-3 right-3 top-3 z-30 w-1.5" aria-hidden="true">
                    {documentSearchMatches.map((match, index) => {
                        const pageCount = Math.max(1, pageDocument?.pages.length ?? 1);
                        const position = ((match.page - 1 + match.bbox.y0) / pageCount) * 100;
                        const active = sameSearchMatch(searchHighlight, match);
                        return (
                            <span
                                key={`${match.page}-${match.bbox.x0}-${match.bbox.y0}-${index}`}
                                className={cn('absolute right-0 h-0.5 rounded-full shadow-sm', active ? 'w-2.5 bg-accent' : 'w-1.5 bg-hl-yellow')}
                                style={{ top: `${Math.max(0, Math.min(100, position))}%` }}
                            />
                        );
                    })}
                </div>
            )}
            </div>
            {dockTab && (
                <DocumentDock
                    documentId={stableId}
                    tab={dockTab}
                    onTabChange={setDockTab}
                    onClose={() => setDockTab(null)}
                    noteCount={notes.length}
                    outline={<OutlinePanel documentKey={stableId} loadSource={loadSource} pages={pageDocument?.pages ?? []} onNavigate={scrollToPageId} />}
                    notes={<NotesPanel
                    documentId={stableId}
                    documentTitle={fileName}
                    notes={notes}
                    activeNoteId={activeNoteId}
                    focusedHighlightId={focusedHighlightId}
                    highlightColor={highlightColor}
                    onCreate={handleCreateNote}
                    onSelect={setActiveNoteId}
                    onChange={handleNoteChange}
                    onDelete={handleNoteDelete}
                    onFocusAnchor={focusNoteAnchor}
                    onAttachFocused={handleAttachFocusedHighlight}
                    onDetachAnchor={handleDetachNoteAnchor}
                />}
                />
            )}
            </div>

            <PageOrganizer
                open={showPageOrganizer}
                pages={pageDocument?.pages ?? []}
                pdfDoc={pdfDoc}
                onClose={() => setShowPageOrganizer(false)}
                onAddBlank={handleAddBlankPage}
                onDelete={handleDeletePages}
                onMove={handleMovePage}
                onRotate={handleRotatePages}
                onMerge={handleMergePdf}
                onExtract={handleExtractPages}
                onSplit={handleSplitPdf}
            />

            <MathModal
                isOpen={showMathModal}
                initialLatex={editingMathAnnotation?.content || ''}
                onClose={() => {
                    setShowMathModal(false);
                    setMathModalOpen(false);
                    if (annotationMode === 'math' && !editingMathAnnotation) {
                        setAnnotationMode(null);
                    }
                    if (editingMathAnnotation) {
                        setEditingMathAnnotation(null);
                    }
                }}
                onInsert={(latex, displayMode) => {
                    if (editingMathAnnotation) {
                        const existing = annotations.find(a => a.id === editingMathAnnotation.id);
                        if (existing && existing.type === 'math') {
                            const updated = {
                                ...existing,
                                content: latex,
                                displayMode: displayMode,
                                updatedAt: Date.now()
                            } as Annotation;
                            handleAnnotationSave(updated);
                        }
                        setEditingMathAnnotation(null);
                    } else {
                        setAwaitingMathPlacement({ content: latex, displayMode });
                    }
                    setShowMathModal(false);
                    setMathModalOpen(false);
                }}
            />
        </div>
    );
}

function sameSearchMatch(left: SearchMatchHighlight | null, right: SearchMatchHighlight): boolean {
    return Boolean(left
        && left.docId === right.docId
        && left.page === right.page
        && left.bbox.x0 === right.bbox.x0
        && left.bbox.y0 === right.bbox.y0);
}

interface PDFPageProps {
    documentId: string;
    pageNum: number;
    pageId: string;
    pdfDoc: pdfjsLib.PDFDocumentProxy | null;
    scale: number;
    annotations: Annotation[];
    onAnnotationSave: (annotation: Annotation) => void;
    onAnnotationDelete: (id: string) => void;
    onAnnotationErase: (deletedIds: string[], created: Annotation[]) => void;
    dimensions?: { width: number, height: number };
    ocrData?: OcrPageResult;
    focusedHighlightId?: string | null;
    onHighlightFocus?: (id: string) => void;
}

function PDFPage({ documentId, pageNum, pageId, pdfDoc, scale, annotations, onAnnotationSave, onAnnotationDelete, onAnnotationErase, dimensions, ocrData, focusedHighlightId, onHighlightFocus }: PDFPageProps) {
    const pageFrameRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const linkLayerRef = useRef<HTMLDivElement>(null);
    const renderTaskRef = useRef<any>(null);
    const { selectionMode, annotationMode } = useDocumentStore(state => state);
    // Read searchHighlight from global AppStore (set by Header)
    const searchHighlight = useAppStore(state => state.searchHighlight);
    const pageSearchMatches = useAppStore(state => state.searchMatches)
        .filter(match => match.docId === documentId && match.page === pageNum);
    const readingFilter = useAppStore(state => state.readingFilter);
    const [viewport, setViewport] = useState<any>(null);
    const [isRendered, setIsRendered] = useState(false);
    const [nativeTextContent, setNativeTextContent] = useState<any>(null);

    // Scroll the actual highlighted rectangle into view. This runs after React
    // commits the overlay, so it also works when the destination page finishes
    // rendering after the search result was selected.
    useEffect(() => {
        if (!viewport || searchHighlight?.docId !== documentId || searchHighlight.page !== pageNum) return;
        const animationFrame = window.requestAnimationFrame(() => {
            pageFrameRef.current
                ?.querySelector<HTMLElement>('[data-active-search-match="true"]')
                ?.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
        });
        return () => window.cancelAnimationFrame(animationFrame);
    }, [documentId, pageNum, searchHighlight, viewport]);

    useEffect(() => {
        if (!pdfDoc || !canvasRef.current || !textLayerRef.current) return;
        let isMounted = true;
        const renderPage = async () => {
            try {
                if (renderTaskRef.current && renderTaskRef.current.cancel) {
                    try { renderTaskRef.current.cancel(); } catch (e) { }
                }
                const page = await pdfDoc.getPage(pageNum);
                if (!isMounted) return;
                const dpr = window.devicePixelRatio || 1;
                const canvasPixelRatio = Math.max(dpr, 2);

                const vp = page.getViewport({ scale: scale });
                setViewport(vp);
                const canvas = canvasRef.current;
                const textLayerDiv = textLayerRef.current;
                const linkLayerDiv = linkLayerRef.current;

                if (!canvas || !textLayerDiv) return;
                const context = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
                if (!context) return;

                canvas.width = Math.floor(vp.width * canvasPixelRatio);
                canvas.height = Math.floor(vp.height * canvasPixelRatio);
                canvas.style.width = `${vp.width}px`;
                canvas.style.height = `${vp.height}px`;
                context.setTransform(canvasPixelRatio, 0, 0, canvasPixelRatio, 0, 0);

                textLayerDiv.innerHTML = '';
                textLayerDiv.style.height = `${vp.height}px`;
                textLayerDiv.style.width = `${vp.width}px`;
                textLayerDiv.style.pointerEvents = 'auto';

                if (linkLayerDiv) linkLayerDiv.innerHTML = '';

                renderTaskRef.current = page.render({ canvasContext: context, viewport: vp } as any);
                await renderTaskRef.current.promise;

                const textContent = await page.getTextContent();
                if (isMounted) setNativeTextContent(textContent);
                textLayerDiv.innerHTML = '';
                textLayerDiv.style.setProperty('--scale-factor', `${scale * dpr}`);
                const textLayer = new (pdfjsLib as any).TextLayer({ textContentSource: textContent, container: textLayerDiv, viewport: vp, textDivs: [] });
                await textLayer.render();

                // Links
                const pageAnnotations = await page.getAnnotations();
                pageAnnotations.forEach((annotation: any) => {
                    if (annotation.subtype === 'Link' && annotation.url && linkLayerDiv) {
                        const link = document.createElement('a');
                        link.href = annotation.url;
                        link.target = '_blank';
                        link.rel = 'noopener noreferrer';
                        const rect = vp.convertToViewportRectangle(annotation.rect);
                        link.style.position = 'absolute';
                        link.style.left = `${Math.min(rect[0], rect[2])}px`;
                        link.style.top = `${Math.min(rect[1], rect[3])}px`;
                        link.style.width = `${Math.abs(rect[2] - rect[0])}px`;
                        link.style.height = `${Math.abs(rect[3] - rect[1])}px`;
                        link.style.cursor = 'pointer';
                        link.style.pointerEvents = 'auto';
                        linkLayerDiv.appendChild(link);
                    }
                });

                if (isMounted) { setIsRendered(true); renderTaskRef.current = null; }
            } catch (error: any) {
                if (error?.name !== 'RenderingCancelledException') console.error(`Error rendering page ${pageNum}:`, error);
            }
        };
        renderPage();
        return () => {
            isMounted = false;
            if (renderTaskRef.current && renderTaskRef.current.cancel) { try { renderTaskRef.current.cancel(); } catch (e) { } }
        };
    }, [pdfDoc, pageNum, scale]);

    const shouldDisableCanvasEvents = annotationMode === 'select' && selectionMode === 'text';
    const width = dimensions ? Math.floor(dimensions.width * scale) : undefined;
    const height = dimensions ? Math.floor(dimensions.height * scale) : undefined;

    return (
        <div
            ref={pageFrameRef}
            data-page-id={pageId}
            data-page-num={pageNum}
            className={cn(
                // The page is elevation 0 — it is the user's document, not
                // chrome. One hairline edge and one seating shadow via
                // --page-shadow are the only depth signals allowed here.
                'relative shrink-0 bg-white border border-line',
            )}
            style={{
                width: width ? `${width}px` : undefined,
                height: height ? `${height}px` : undefined,
                boxShadow: 'var(--page-shadow)',
                // Optional per-document night-reading filter, applied to the
                // rendered canvas only; the underlying PDF is never modified.
                filter: readingFilter === 'dim'
                    ? 'brightness(0.85) contrast(0.92)'
                    : readingFilter === 'sepia'
                        ? 'sepia(0.35)'
                        : undefined,
            }}
        >
            <canvas ref={canvasRef} className="block pdf-base-canvas" data-page-num={pageNum} />

            {/* Native PDF.js TextLayer - Always render, selectable in select mode */}
            <div
                ref={textLayerRef}
                className="textLayer absolute inset-0 mix-blend-multiply"
                style={{
                    zIndex: shouldDisableCanvasEvents ? 15 : 1,
                    pointerEvents: shouldDisableCanvasEvents ? 'auto' : 'none'
                }}
            />

            {/* OCR Text Layer Overlay - Only if we have OCR data, takes priority over native */}
            {ocrData && ocrData.tokens.length > 0 && viewport && nativeTextContent && (
                <OcrTextLayer
                    tokens={ocrData.tokens}
                    width={viewport.width}
                    height={viewport.height}
                    scale={scale}
                    debug={false}
                    annotationMode={annotationMode}
                    nativeTextContent={nativeTextContent}
                    viewport={viewport}
                />
            )}

            {viewport && (
                <div style={{ position: 'absolute', left: '-2.5%', top: '-2.5%', width: '105%', height: '105%', zIndex: shouldDisableCanvasEvents ? 1 : 8, pointerEvents: shouldDisableCanvasEvents ? 'none' : 'auto' }}>
                    <AnnotationCanvas
                        pageNum={pageNum}
                        viewport={viewport}
                        annotations={annotations}
                        onSave={onAnnotationSave}
                        onDelete={onAnnotationDelete}
                        onErase={onAnnotationErase}
                        textLayerRef={textLayerRef as any}
                        onImageUpload={() => { }}
                        focusedHighlightId={focusedHighlightId}
                        onHighlightFocus={onHighlightFocus}
                    />
                </div>
            )}
            <div ref={linkLayerRef} className="absolute inset-0 z-10" style={{ pointerEvents: 'none' }} />

            {/* Find-in-PDF highlights: every match is visible; active is stronger. */}
            {pageSearchMatches.length > 0 && viewport && (() => {
                const displayedWidth = viewport.width;
                const displayedHeight = viewport.height;
                const clampNorm = (b: { x0: number; y0: number; x1: number; y1: number }) => ({
                    x0: Math.max(0, Math.min(1, b.x0)),
                    y0: Math.max(0, Math.min(1, b.y0)),
                    x1: Math.max(0, Math.min(1, b.x1)),
                    y1: Math.max(0, Math.min(1, b.y1)),
                });
                return pageSearchMatches.flatMap((match, matchIndex) => {
                    const active = sameSearchMatch(searchHighlight, match);
                    const bboxes = match.spans?.length
                        ? match.spans.map(span => clampNorm(span.bbox))
                        : [clampNorm(match.bbox)];
                    return bboxes.map((bbox, spanIndex) => (
                        <div
                            key={`${matchIndex}-${spanIndex}`}
                            data-active-search-match={active ? 'true' : undefined}
                            style={{
                                position: 'absolute',
                                left: `${bbox.x0 * displayedWidth}px`,
                                top: `${bbox.y0 * displayedHeight}px`,
                                width: `${Math.max(3, (bbox.x1 - bbox.x0) * displayedWidth)}px`,
                                height: `${Math.max(3, (bbox.y1 - bbox.y0) * displayedHeight)}px`,
                                background: active ? 'rgba(245, 158, 11, 0.62)' : 'rgba(250, 204, 21, 0.34)',
                                outline: active ? '2px solid rgba(217, 119, 6, 0.95)' : '1px solid rgba(202, 138, 4, 0.45)',
                                borderRadius: '2px',
                                pointerEvents: 'none',
                                zIndex: active ? 41 : 40,
                            }}
                        />
                    ));
                });
            })()}

            {!isRendered && (
                <div
                    className={cn(
                        // Paper-coloured placeholder at the final page size.
                        // A single subtle shimmer only when motion is allowed
                        // — the token media block below zeroes the duration.
                        'absolute inset-0 flex items-center justify-center bg-sunken',
                        'animate-pulse',
                    )}
                    style={{ animationDuration: '2s' }}
                >
                    <div className="font-mono text-xs text-text-muted">Loading page {pageNum}…</div>
                </div>
            )}
        </div>
    );
}
