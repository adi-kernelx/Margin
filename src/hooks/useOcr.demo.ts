import type { OcrPageResult } from '@/lib/ocr/client-ocr';
import type { useClientOcr } from './useClientOcr';

const NO_PAGES: Record<number, OcrPageResult> = {};
const noop = async () => {};

/** OCR stand-in for the demo build: never starts, never has pages. */
export const useOcr: typeof useClientOcr = () => ({
    startOcr: noop,
    status: 'idle',
    progress: 0,
    pages: NO_PAGES,
    gateResult: undefined,
});
