import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { useAppStore } from '@/lib/store';
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
} from '@/lib/annotations/operations';
import { applyOperationToAnnotations } from '@/core/annotations/apply';
import { AnnotationCanvas } from './AnnotationCanvas';
import { MathModal } from './MathModal';
import type { Annotation, Operation } from '@/lib/annotations/models';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractAnnotations, embedAnnotations } from '@/lib/pdf-data-manager';
import { localFileDB } from '@/lib/storage/local-file-db';
import { useClientOcr } from '@/hooks/useClientOcr';
import { OcrTextLayer } from './OcrTextLayer';
import type { OcrPageResult } from '@/lib/ocr/client-ocr';
import { localSearchRegistry } from '@/lib/search/local-search';
import type { PageDocument, PageRecord } from '@/core/pages/models';
import {
    annotationsForExistingPages,
    applyOperationToPageDocument,
    attachAnnotationsToPageIds,
    createPageDocument,
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
import { Button } from './ui/Button';
import { LayoutGrid } from 'lucide-react';
import { rotateAnnotation } from '@/core/pages/annotations';

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

export function PDFViewer({ file, fileUrl, fileId, stableId, parentFolderId, role = 'owner', displayName, annotationsUrl, shareId, linkToken }: PDFViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    const [pageDocument, setPageDocument] = useState<PageDocument | null>(null);
    const pageDocumentRef = useRef<PageDocument | null>(null);
    const workingPdfBytesRef = useRef<Uint8Array | null>(null);
    const pageRenderRevisionRef = useRef(0);
    const [showPageOrganizer, setShowPageOrganizer] = useState(false);
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const annotationsRef = useRef<Annotation[]>([]);
    const setLoadedAnnotations = useCallback((loaded: Annotation[]) => {
        const document = pageDocumentRef.current;
        const next = document ? attachAnnotationsToPageIds(loaded, document) : loaded;
        annotationsRef.current = next;
        setAnnotations(next);
        void annotationStorage.saveSidecar(stableId, next);
    }, [stableId]);
    const [showMathModal, setShowMathModal] = useState(false);
    
    // To prevent "unused variable" warnings
    console.log(shareId, linkToken);

    // Throttled save ref
    const saveTimeoutRef = useRef<number | undefined>(undefined);
    // Track page count for payload provider to avoid dependency cycles
    const pageCountRef = useRef(0);

    const {
        isDarkMode,
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
    const { startOcr, pages: ocrPages, status: _clientOcrStatus } = useClientOcr(fileId, pdfDoc);

    // Auto-start Client OCR / Global Store Sync
    useEffect(() => {
        if (!parentFolderId && fileId && pdfDoc) {
            // Register for local search
            const fingerprint = pdfDoc.fingerprints?.[0] || fileId;
            localSearchRegistry.register(fileId, fingerprint, pdfDoc, () => ocrPages);
            
            startOcr();
            
            return () => {
                localSearchRegistry.unregister(fileId);
            };
        }
    }, [fileId, parentFolderId, pdfDoc, ocrPages, startOcr]);

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

                // Dispatch fingerprint for search indexing
                const fingerprint = stableId;
                if (fingerprint && fileId) {
                    window.dispatchEvent(new CustomEvent('pdf-loaded', {
                        detail: { fileId, fingerprint }
                    }));
                }

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
                            setLoadedAnnotations(annots);
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
                                setLoadedAnnotations(annots);
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
                                    setLoadedAnnotations(annots);
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
                            if (mounted) setLoadedAnnotations(backup.annotationsJSON.objects);
                            return;
                        }
                    }
                } catch (e) {
                    console.error('Backup check failed:', e);
                }
            }

            // 1. Try Embedded Data (Portable Source)
            if (file) {
                const embedded = await extractAnnotations(file);
                if (!mounted) return;
                if (embedded) {
                    console.log('[PDFViewer] Loaded from embedded data:', embedded.length);
                    setLoadedAnnotations(embedded);
                    return;
                }
            }

            // 2. Fallback to Sidecar (Local Source)
            const loaded = await annotationStorage.loadSidecar(stableId);
            if (!mounted) return;
            if (loaded) {
                console.log('[PDFViewer] Sidecar found:', loaded.length, 'annotations');
                setLoadedAnnotations(loaded);
            } else {
                console.log('[PDFViewer] No sidecar or embedded data found.');
                setLoadedAnnotations([]);
            }
        };
        loadAnnotations();

        return () => {
            mounted = false;
        };
    }, [stableId, file, fileId, parentFolderId, setLoadedAnnotations]);

    // External JSON Load Event Listener
    useEffect(() => {
        const handleExternalLoad = (e: CustomEvent<{ docId: string, annotations: Annotation[] }>) => {
            if (e.detail.docId === fileId) {
                console.log('[PDFViewer] External JSON loaded:', e.detail.annotations.length);

                setLoadedAnnotations(e.detail.annotations);
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
    const scheduleSidecarSave = useCallback((currentAnnotations: Annotation[]) => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

        saveTimeoutRef.current = window.setTimeout(async () => {
            // Local Cache (Always) - this is just for crash recovery
            await annotationStorage.saveSidecar(stableId, currentAnnotations);
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
            scheduleSidecarSave(next);
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
            await embedAnnotations(pdfLibDoc, visibleAnnotations);
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
        const next = applyOperationToAnnotations(annotationsRef.current, operation);
        annotationsRef.current = next;
        setAnnotations(next);
        scheduleSidecarSave(next);
        saveManager.markDirty(fileId);
        setIsDirty(true);
        await operationManager.addOperation(operation);
    }, [fileId, scheduleSidecarSave, setIsDirty]);

    const handleAnnotationSave = useCallback(async (annotation: Annotation) => {
        const page = pageDocumentRef.current?.pages[annotation.pageNum - 1];
        const anchored = page ? { ...annotation, pageId: page.id } : annotation;
        const previous = annotationsRef.current.find(item => item.id === anchored.id);
        const operation = previous
            ? createUpdateOperation(anchored, previous, fileId)
            : createAddOperation(anchored, fileId);
        await commitAnnotationOperation(operation);
    }, [commitAnnotationOperation, fileId]);

    const handleAnnotationDelete = useCallback(async (id: string) => {
        const annotation = annotationsRef.current.find(item => item.id === id);
        if (annotation) await commitAnnotationOperation(createDeleteOperation(annotation, fileId));
    }, [commitAnnotationOperation, fileId]);

    const handleAnnotationErase = useCallback(async (deletedIds: string[], created: Annotation[]) => {
        const operations: Operation[] = [];
        for (const id of deletedIds) {
            const annotation = annotationsRef.current.find(item => item.id === id);
            if (annotation) operations.push(createDeleteOperation(annotation, fileId));
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
        scheduleSidecarSave(nextAnnotations);
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
        const pdf = await PDFDocument.load(bytes);
        await embedAnnotations(pdf, selectedAnnotations);
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

    // ... (Remainder unchanged) ...


    // ... Render logic (Pages) ...
    return (
        <div className={`flex-1 flex flex-col h-full relative ${isDarkMode ? 'bg-gray-900' : 'bg-gray-100'}`} ref={containerRef}>
            <Button
                size="sm"
                className="absolute right-5 top-5 z-20"
                leadingIcon={<LayoutGrid size={16} />}
                disabled={role === 'viewer'}
                onClick={() => setShowPageOrganizer(true)}
            >Pages</Button>
            <div className="flex-1 overflow-y-auto w-full flex flex-col items-center gap-4 p-4">
                {(pageDocument?.pages ?? []).map((page, index) => {
                    const pageNum = index + 1;
                    return (
                    <PDFPage
                        key={`${fileId}-page-${page.id}`}
                        pageNum={pageNum}
                        pdfDoc={pdfDoc}
                        scale={scale}
                        annotations={annotations.filter(a => a.pageId ? a.pageId === page.id : a.pageNum === pageNum)}
                        onAnnotationSave={handleAnnotationSave}
                        onAnnotationDelete={handleAnnotationDelete}
                        onAnnotationErase={handleAnnotationErase}
                        dimensions={pageDimensions[pageNum]}
                        ocrData={ocrPages[pageNum]}
                    />
                    );
                })}
            </div>

            <PageOrganizer
                open={showPageOrganizer}
                pages={pageDocument?.pages ?? []}
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

interface PDFPageProps {
    pageNum: number;
    pdfDoc: pdfjsLib.PDFDocumentProxy | null;
    scale: number;
    annotations: Annotation[];
    onAnnotationSave: (annotation: Annotation) => void;
    onAnnotationDelete: (id: string) => void;
    onAnnotationErase: (deletedIds: string[], created: Annotation[]) => void;
    dimensions?: { width: number, height: number };
    ocrData?: OcrPageResult;
}

function PDFPage({ pageNum, pdfDoc, scale, annotations, onAnnotationSave, onAnnotationDelete, onAnnotationErase, dimensions, ocrData }: PDFPageProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const linkLayerRef = useRef<HTMLDivElement>(null);
    const renderTaskRef = useRef<any>(null);
    const { isDarkMode, selectionMode, annotationMode } = useDocumentStore(state => state);
    // Read searchHighlight from global AppStore (set by Header)
    const searchHighlight = useAppStore(state => state.searchHighlight);
    const [viewport, setViewport] = useState<any>(null);
    const [isRendered, setIsRendered] = useState(false);
    const [nativeTextContent, setNativeTextContent] = useState<any>(null);

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
        <div className={`relative shadow-lg ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`} style={width ? { width: `${width}px`, height: `${height}px` } : undefined}>
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
                    />
                </div>
            )}
            <div ref={linkLayerRef} className="absolute inset-0 z-10" style={{ pointerEvents: 'none' }} />

            {/* Search Highlight Overlay - Robust Implementation */}
            {searchHighlight && searchHighlight.page === pageNum && canvasRef.current && (() => {
                // Get actual displayed canvas size (handles zoom/DPR)
                const displayedWidth = canvasRef.current.clientWidth;
                const displayedHeight = canvasRef.current.clientHeight;

                if (!displayedWidth || !displayedHeight) return null;

                // Helper: clamp normalized bbox to 0-1
                const clampNorm = (b: { x0: number; y0: number; x1: number; y1: number }) => ({
                    x0: Math.max(0, Math.min(1, b.x0)),
                    y0: Math.max(0, Math.min(1, b.y0)),
                    x1: Math.max(0, Math.min(1, b.x1)),
                    y1: Math.max(0, Math.min(1, b.y1)),
                });

                // Use spans if available (more precise), otherwise use single bbox
                const bboxes = (searchHighlight.spans && searchHighlight.spans.length > 0)
                    ? searchHighlight.spans.map(s => clampNorm(s.bbox))
                    : [clampNorm(searchHighlight.bbox)];

                // Check if this looks like a full-page bbox (area > 80% of page)
                const mainBbox = clampNorm(searchHighlight.bbox);
                const areaFraction = (mainBbox.x1 - mainBbox.x0) * (mainBbox.y1 - mainBbox.y0);

                // Skip rendering if bbox covers too much of the page (likely a whole-chunk match)
                // Still show a subtle border indicator instead
                if (areaFraction > 0.8 && !searchHighlight.spans?.length) {
                    console.log(`[PDFPage ${pageNum}] Skipping full-page highlight (area: ${(areaFraction * 100).toFixed(1)}%)`);
                    return (
                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                border: '3px solid rgba(245, 158, 11, 0.6)',
                                borderRadius: '4px',
                                pointerEvents: 'none',
                                zIndex: 30,
                                animation: 'pulse 1.5s ease-in-out infinite',
                            }}
                        />
                    );
                }

                // Convert normalized bbox to CSS pixels
                // NOTE: Check if your OCR bboxes use top-left origin (y0 < y1) or bottom-left origin (y0 > y1)
                // PaddleOCR typically uses top-left origin, so no Y-flip needed
                const rects = bboxes.map(b => {
                    const left = b.x0 * displayedWidth;
                    const width = Math.max(4, (b.x1 - b.x0) * displayedWidth);
                    const height = Math.max(4, (b.y1 - b.y0) * displayedHeight);
                    // Top-left origin (no Y-flip) - adjust if your coords are bottom-left
                    const top = b.y0 * displayedHeight;
                    // Uncomment below if you need Y-flip (bottom-left origin):
                    // const top = (1 - b.y1) * displayedHeight;
                    return { left, top, width, height };
                });

                console.log(`[PDFPage ${pageNum}] Rendering ${rects.length} highlight(s):`, rects[0]);

                return rects.map((r, i) => (
                    <div
                        key={i}
                        style={{
                            position: 'absolute',
                            left: `${r.left}px`,
                            top: `${r.top}px`,
                            width: `${r.width}px`,
                            height: `${r.height}px`,
                            background: 'rgba(255, 230, 120, 0.4)',
                            border: '2px solid rgba(245, 158, 11, 0.9)',
                            borderRadius: '3px',
                            pointerEvents: 'none',
                            zIndex: 40,
                            boxShadow: '0 0 8px rgba(245, 158, 11, 0.4)',
                            animation: 'pulse 1.5s ease-in-out infinite',
                            transition: 'all 120ms ease-out',
                        }}
                    />
                ));
            })()}

            {!isRendered && (
                <div className={`absolute inset-0 flex items-center justify-center ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                    <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Loading page {pageNum}...</div>
                </div>
            )}
        </div>
    );
}
