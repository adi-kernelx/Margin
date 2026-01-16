
import { useState, useCallback, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { detectLanguage, runClientOcr, type OcrPageResult, type LanguageGateResult } from '@/lib/ocr/client-ocr';
import { localFileDB } from '@/lib/storage/local-file-db';
import { ingestOcrData, isDocumentIngested } from '@/lib/ingest-service';

interface ClientOcrState {
    status: 'idle' | 'detecting' | 'running' | 'complete' | 'blocked' | 'error';
    gateResult?: LanguageGateResult;
    progress: number; // 0..1
    pages: Record<number, OcrPageResult>;
}

// Global Singleton Queue for Sequential OCR
interface OcrTask {
    fileId: string;
    pageNum: number;
    canvas: HTMLCanvasElement;
    resolve: (result: OcrPageResult) => void;
    reject: (err: any) => void;
}

class OcrQueue {
    private queue: OcrTask[] = [];
    private running = false;

    add(fileId: string, pageNum: number, canvas: HTMLCanvasElement): Promise<OcrPageResult> {
        return new Promise((resolve, reject) => {
            this.queue.push({ fileId, pageNum, canvas, resolve, reject });
            this.process();
        });
    }

    private async process() {
        if (this.running) return;
        this.running = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift();
            if (!task) break;

            try {
                // Short delay to yield UI to prevent freezing
                await new Promise(r => setTimeout(r, 50));

                const result = await runClientOcr(task.canvas);
                task.resolve(result);
            } catch (e) {
                task.reject(e);
            }
        }

        this.running = false;
    }
}

// Singleton Queue Instance
const globalOcrQueue = new OcrQueue();

export function useClientOcr(fileId: string, pdfDoc: pdfjsLib.PDFDocumentProxy | null) {
    const [state, setState] = useState<ClientOcrState>({
        status: 'idle',
        progress: 0,
        pages: {}
    });

    const abortRef = useRef(false);
    const startedRef = useRef<string | null>(null); // Track if we've started for this fileId

    // Initial load from cache (by fileId or fingerprint)
    useEffect(() => {
        if (!fileId) return;

        const loadFromCache = async () => {
            // First try by fileId
            let file = await localFileDB.getLocalFile(fileId);
            const fingerprint = pdfDoc?.fingerprints?.[0];

            // If no OCR data by fileId, try by fingerprint
            if ((!file || !file.ocrData || Object.keys(file.ocrData).length === 0) && pdfDoc) {
                if (fingerprint) {
                    const cachedOcr = await localFileDB.getOcrCacheByFingerprint(fingerprint);
                    if (cachedOcr) {
                        console.log('[useClientOcr] Loaded from cache (by fingerprint):', Object.keys(cachedOcr).length, 'pages');
                        startedRef.current = fileId;
                        setState(prev => ({
                            ...prev,
                            status: 'complete',
                            progress: 1,
                            pages: cachedOcr as Record<number, OcrPageResult>
                        }));

                        // Auto-ingest if not already in Qdrant
                        if (fingerprint) {
                            const alreadyIngested = await isDocumentIngested(fingerprint);
                            if (!alreadyIngested) {
                                console.log('[useClientOcr] Auto-ingesting cached data to Qdrant...');
                                await ingestOcrData(fileId, fingerprint, cachedOcr as Record<number, OcrPageResult>);
                            }
                        }
                        return;
                    }
                }
            }

            // Load by fileId if found
            if (file && file.ocrData) {
                const pages = file.ocrData as Record<number, OcrPageResult>;
                const pageCount = Object.keys(pages).length;
                if (pageCount > 0) {
                    console.log('[useClientOcr] Loaded from cache (by fileId):', pageCount, 'pages');
                    startedRef.current = fileId;
                    setState(prev => ({
                        ...prev,
                        status: 'complete',
                        progress: 1,
                        pages: pages
                    }));

                    // Auto-ingest if not already in Qdrant
                    if (fingerprint) {
                        const alreadyIngested = await isDocumentIngested(fingerprint);
                        if (!alreadyIngested) {
                            console.log('[useClientOcr] Auto-ingesting cached data to Qdrant...');
                            await ingestOcrData(fileId, fingerprint, pages, file.displayName);
                        }
                    }
                }
            }
        };

        loadFromCache();
    }, [fileId, pdfDoc]);

    const startOcr = useCallback(async () => {
        if (!pdfDoc || !fileId) return;

        // Skip if already started for this file (ref-based guard for StrictMode)
        if (startedRef.current === fileId) {
            console.log('[useClientOcr] Already started/completed for', fileId);
            return;
        }

        // Get PDF fingerprint for caching
        const fingerprint = pdfDoc.fingerprints?.[0];

        // Double-check fingerprint cache before starting OCR
        // This catches cases where the same PDF is opened from a different location
        if (fingerprint) {
            const cachedOcr = await localFileDB.getOcrCacheByFingerprint(fingerprint);
            if (cachedOcr && Object.keys(cachedOcr).length > 0) {
                console.log('[useClientOcr] Found existing cache by fingerprint, skipping OCR for', fileId);
                startedRef.current = fileId;
                setState(prev => ({
                    ...prev,
                    status: 'complete',
                    progress: 1,
                    pages: cachedOcr as Record<number, OcrPageResult>
                }));

                // Also link this fileId to the fingerprint for future lookups
                await localFileDB.updateLocalFile(fileId, { pdfFingerprint: fingerprint, ocrData: cachedOcr });
                return;
            }
        }

        startedRef.current = fileId;

        console.log('[useClientOcr] Starting pipeline for', fileId, 'fingerprint:', fingerprint);
        setState(prev => ({ ...prev, status: 'detecting', progress: 0 }));
        abortRef.current = false;

        // Ensure the file entry exists with proper fingerprint
        if (fingerprint) {
            const existingFile = await localFileDB.getLocalFile(fileId);
            if (!existingFile) {
                await localFileDB.createLocalFile({
                    localFileId: fileId,
                    pdfFingerprint: fingerprint,
                    displayName: 'PDF Document',
                    autosaveEnabled: false,
                    autosaveIntervalSec: 10,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                });
            } else if (existingFile.pdfFingerprint !== fingerprint) {
                // Update fingerprint if different (e.g., fileId reused for different PDF)
                await localFileDB.updateLocalFile(fileId, { pdfFingerprint: fingerprint });
            }
        }

        try {
            // 1. Language Gate Detection
            const page1 = await pdfDoc.getPage(1);
            const vp = page1.getViewport({ scale: 1.0 });
            const canvas = document.createElement('canvas');
            canvas.width = vp.width;
            canvas.height = vp.height;
            const ctx = canvas.getContext('2d');

            let gate: LanguageGateResult = { allowed: true }; // default allow if ctx fails (rare)

            if (ctx) {
                await page1.render({ canvasContext: ctx, viewport: vp } as any).promise;
                gate = await detectLanguage(canvas);
                console.log('[useClientOcr] Gate result:', gate);
                // Language gate removed - OCR now runs for all languages (Hindi, Arabic, etc.)
                // Previously blocked non-Latin scripts, now we always proceed
            } else {
                console.warn('[useClientOcr] Canvas context missing, skipping gate');
            }

            // 3. Run OCR loop via Queue
            setState(prev => ({ ...prev, status: 'running', gateResult: gate }));
            const totalPages = pdfDoc.numPages;

            for (let i = 1; i <= totalPages; i++) {
                if (abortRef.current) break;

                // Check cache AGAIN for specific page (if partially cached from previous run)
                const file = await localFileDB.getLocalFile(fileId);
                const fileOcrData = file?.ocrData as Record<number, OcrPageResult> | undefined;

                if (fileOcrData && fileOcrData[i]) {
                    const cachedRes = fileOcrData[i];
                    setState(prev => ({
                        ...prev,
                        pages: { ...prev.pages, [i]: cachedRes },
                        progress: i / totalPages
                    }));
                    continue;
                }

                console.log(`[useClientOcr] Queueing page ${i}/${totalPages}`);

                // Render page for OCR
                const page = await pdfDoc.getPage(i);
                const viewport = page.getViewport({ scale: 2.0 });
                const pCanvas = document.createElement('canvas');
                pCanvas.width = viewport.width;
                pCanvas.height = viewport.height;
                const pCtx = pCanvas.getContext('2d');

                if (!pCtx) continue;
                await page.render({ canvasContext: pCtx, viewport } as any).promise;

                // Enqueue to Global Queue (Sequential)
                const result = await globalOcrQueue.add(fileId, i, pCanvas);

                // Save and Update State
                await localFileDB.savePageOcr(fileId, i, result);

                setState(prev => ({
                    ...prev,
                    progress: i / totalPages,
                    pages: { ...prev.pages, [i]: result }
                }));
            }

            setState(prev => ({ ...prev, status: 'complete', progress: 1 }));

            // 4. Auto-ingest to Qdrant for semantic search
            if (fingerprint) {
                const finalFile = await localFileDB.getLocalFile(fileId);
                const finalOcrData = finalFile?.ocrData as Record<number, OcrPageResult> | undefined;
                if (finalOcrData && Object.keys(finalOcrData).length > 0) {
                    console.log('[useClientOcr] Auto-ingesting to Qdrant...');
                    const ingestResult = await ingestOcrData(
                        fileId,
                        fingerprint,
                        finalOcrData,
                        finalFile?.displayName
                    );
                    console.log('[useClientOcr] Ingest result:', ingestResult);
                }
            }

        } catch (e) {
            console.error('[useClientOcr] Failed:', e);
            setState(prev => ({ ...prev, status: 'error' }));
        }

    }, [fileId, pdfDoc, state.status]);

    return {
        startOcr,
        status: state.status,
        progress: state.progress,
        pages: state.pages,
        gateResult: state.gateResult
    };
}
