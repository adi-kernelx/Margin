/**
 * Ingest Service - Automatically sends OCR data to Qdrant for semantic search
 * 
 * This module handles:
 * - Checking if a document is already ingested
 * - Sending OCR data to the ingest API
 * - Caching by PDF fingerprint to avoid duplicate work
 */

import type { OcrPageResult } from './ocr/client-ocr';

const INGEST_API_URL = 'http://localhost:9101';

export interface IngestResponse {
    success: boolean;
    chunksIngested: number;
    message: string;
    cached?: boolean;
}

export interface IngestStatusResponse {
    ingested: boolean;
    chunkCount: number;
    pdfFingerprint: string;
}

/**
 * Check if a document has already been ingested
 */
export async function isDocumentIngested(pdfFingerprint: string): Promise<boolean> {
    try {
        const response = await fetch(`${INGEST_API_URL}/status/${pdfFingerprint}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            console.warn('[IngestService] Status check failed:', response.status);
            return false;
        }

        const data: IngestStatusResponse = await response.json();
        return data.ingested;
    } catch (error) {
        console.warn('[IngestService] Status check error (service may be offline):', error);
        return false;
    }
}

/**
 * Full status for display. Returns null when the service is unreachable, so
 * the UI can tell "not indexed" apart from "cannot tell".
 */
export async function getIngestStatus(pdfFingerprint: string, signal?: AbortSignal): Promise<IngestStatusResponse | null> {
    try {
        const response = await fetch(`${INGEST_API_URL}/status/${encodeURIComponent(pdfFingerprint)}`, { signal });
        if (!response.ok) return null;
        return await response.json() as IngestStatusResponse;
    } catch {
        return null;
    }
}

/**
 * Ingest OCR data for a document
 */
export async function ingestOcrData(
    docId: string,
    pdfFingerprint: string,
    ocrData: Record<number, OcrPageResult>,
    displayName?: string
): Promise<IngestResponse> {
    console.log('[IngestService] Starting ingestion for:', pdfFingerprint);
    console.log('[IngestService] Pages:', Object.keys(ocrData).length);

    try {
        // Convert OcrPageResult to API format
        const formattedOcrData: Record<string, any> = {};
        for (const [pageNum, pageData] of Object.entries(ocrData)) {
            formattedOcrData[pageNum] = {
                tokens: pageData.tokens.map(t => ({
                    text: t.text,
                    bbox: t.bbox,
                    confidence: t.confidence,
                    fontSizeNorm: t.fontSizeNorm
                })),
                avgConfidence: pageData.avgConfidence,
                detectedScript: pageData.detectedScript
            };
        }

        const response = await fetch(`${INGEST_API_URL}/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                docId,
                pdfFingerprint,
                displayName,
                ocrData: formattedOcrData
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[IngestService] Ingest failed:', response.status, errorText);
            return {
                success: false,
                chunksIngested: 0,
                message: `Ingest failed: ${response.status}`
            };
        }

        const result: IngestResponse = await response.json();
        console.log('[IngestService] Ingest result:', result);
        return result;

    } catch (error) {
        console.warn('[IngestService] Ingest error (service may be offline):', error);
        return {
            success: false,
            chunksIngested: 0,
            message: `Ingest service unavailable: ${error}`
        };
    }
}

/**
 * Check if the ingest service is available
 */
export async function isIngestServiceAvailable(): Promise<boolean> {
    try {
        const response = await fetch(`${INGEST_API_URL}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(2000)
        });
        return response.ok;
    } catch {
        return false;
    }
}
