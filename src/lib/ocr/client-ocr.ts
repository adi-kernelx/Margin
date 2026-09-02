
import Tesseract from 'tesseract.js';

export interface OcrBBox {
    x: number; // Normalized 0..1
    y: number;
    w: number;
    h: number;
}

export interface OcrToken {
    text: string;
    bbox: OcrBBox;
    confidence: number;
    fontSizeNorm: number; // Approximate font size relative to page height
}

export interface OcrPageResult {
    tokens: OcrToken[];
    blocks: any[]; // Raw blocks if needed
    avgConfidence: number;
    detectedScript?: string;
}

export interface LanguageGateResult {
    allowed: boolean;
    reason?: string;
    detectedScript?: string;
    confidence?: number;
}

/**
 * Run language detection on a page image (blob or canvas).
 * Returns { allowed, script, confidence }
 * 
 * Note: Language gate is now disabled - OCR runs for all languages.
 * This function is kept for logging/diagnostic purposes only.
 */
export async function detectLanguage(image: Blob | HTMLCanvasElement): Promise<LanguageGateResult> {
    // Use 'eng' model for a quick heuristic check
    const worker = await Tesseract.createWorker('eng');

    try {
        const ret = await worker.recognize(image);
        const data = ret.data;

        const confidence = data.confidence;
        const text = data.text;

        // Analyze text for Latin script content
        const totalChars = text.replace(/\s/g, '').length;
        if (totalChars === 0) {
            return { allowed: true, confidence: 100, detectedScript: 'Empty/Unknown' };
        }

        const latinMatch = text.match(/[a-zA-Z]/g);
        const latinCount = latinMatch ? latinMatch.length : 0;
        const latinRatio = latinCount / totalChars;

        // Check for Devanagari (Hindi) characters
        const devanagariMatch = text.match(/[\u0900-\u097F]/g);
        const devanagariCount = devanagariMatch ? devanagariMatch.length : 0;

        // Check for Arabic characters  
        const arabicMatch = text.match(/[\u0600-\u06FF]/g);
        const arabicCount = arabicMatch ? arabicMatch.length : 0;

        // Determine detected script
        let detectedScript = 'Latin';
        if (devanagariCount > latinCount) {
            detectedScript = 'Devanagari (Hindi)';
        } else if (arabicCount > latinCount) {
            detectedScript = 'Arabic';
        } else if (latinRatio < 0.4) {
            detectedScript = 'Non-Latin (Mixed)';
        }

        console.log(`[ClientOCR] Detection - Confidence: ${confidence}%, Latin Ratio: ${latinRatio.toFixed(2)}, Script: ${detectedScript}`);

        // Always allow - language gate disabled for multilingual support
        return {
            allowed: true,
            detectedScript,
            confidence
        };

    } catch (e) {
        console.error("Language detection failed", e);
        return { allowed: true, detectedScript: 'Unknown (error)' };
    } finally {
        await worker.terminate();
    }
}

// Local PaddleOCR service only
const LOCAL_OCR_URL = 'http://localhost:8000/ocr/recognize';

/**
 * Run Client-side OCR on a single page image
 * Uses local PaddleOCR service at localhost:8000
 */
export async function runClientOcr(image: Blob | HTMLCanvasElement): Promise<OcrPageResult> {
    // Convert canvas to blob if needed
    const blob = (image instanceof Blob)
        ? image
        : await new Promise<Blob | null>(r => (image as HTMLCanvasElement).toBlob(r, 'image/png')).then(b => b);

    if (!blob) {
        console.error('[ClientOCR] Failed to convert image to blob');
        return { tokens: [], blocks: [], avgConfidence: 0 };
    }

    // Use Local PaddleOCR Service
    try {
        const formData = new FormData();
        formData.append('file', blob, 'page.png');
        formData.append('page', '1');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s timeout (PaddleOCR cold start can be slow)

        console.log('[ClientOCR] Using Local PaddleOCR service...');
        const res = await fetch(LOCAL_OCR_URL, {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
            const sidecar = await res.json();
            console.log('[ClientOCR] Local PaddleOCR success:', sidecar);

            return {
                tokens: sidecar.tokens,
                blocks: [],
                avgConfidence: 95,
                detectedScript: 'local-paddleocr'
            };
        } else {
            console.warn('[ClientOCR] Local PaddleOCR returned error:', res.status);
        }
    } catch (e: any) {
        if (e.name === 'AbortError') {
            console.warn('[ClientOCR] Local PaddleOCR timeout');
        } else {
            console.warn('[ClientOCR] Local PaddleOCR unavailable:', e.message);
        }
    }

    // No OCR available
    console.error('[ClientOCR] Local PaddleOCR service unavailable. Make sure it is running at localhost:8000');
    return {
        tokens: [],
        blocks: [],
        avgConfidence: 0
    };
}

