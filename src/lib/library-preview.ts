import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export async function createLibraryPreview(blob: Blob): Promise<{ pageCount: number; coverThumbnail: string }> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const document = await pdfjsLib.getDocument({ data: bytes }).promise;
    try {
        const page = await document.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(1, 180 / base.width);
        const viewport = page.getViewport({ scale });
        const canvas = window.document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas 2D is unavailable');
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        return { pageCount: document.numPages, coverThumbnail: canvas.toDataURL('image/jpeg', 0.72) };
    } finally {
        await document.destroy();
    }
}
