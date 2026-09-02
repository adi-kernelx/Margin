import { PDFDocument } from 'pdf-lib';
import type { AnnotationData } from '../../types/editor-types';
import type { Annotation } from '../annotations/models';
import { renderPageAnnotationsToCanvas } from '../rendering/annotation-renderer';

export async function flattenLocalPDF(
    pdfBytes: ArrayBuffer,
    annotations: AnnotationData,
    dpiScale: number = 4
): Promise<Blob> {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();

    // Group annotations by page
    const annotationsByPage = new Map<number, Annotation[]>();
    annotations.objects.forEach(ann => {
        const pageNum = ann.pageNum;
        if (!annotationsByPage.has(pageNum)) {
            annotationsByPage.set(pageNum, []);
        }
        annotationsByPage.get(pageNum)!.push(ann);
    });

    for (let i = 0; i < pages.length; i++) {
        const pageNum = i + 1;
        const pageAnns = annotationsByPage.get(pageNum);
        if (!pageAnns || pageAnns.length === 0) continue;

        const page = pages[i];
        const { width, height } = page.getSize();

        // Setup offscreen canvas
        const canvas = document.createElement('canvas');

        // Render annotations to canvas using shared renderer
        // The renderer handles scaling and specific annotation type logic
        await renderPageAnnotationsToCanvas(canvas, pageAnns, { width, height }, dpiScale);

        // Export to PNG
        const pngUrl = canvas.toDataURL('image/png');
        const pngImageBytes = await fetch(pngUrl).then(res => res.arrayBuffer());

        const pngImage = await pdfDoc.embedPng(pngImageBytes);

        page.drawImage(pngImage, {
            x: 0,
            y: 0,
            width: width,
            height: height,
            opacity: 1,
        });
    }

    const pdfBytesOut = await pdfDoc.save();
    return new Blob([pdfBytesOut as any], { type: 'application/pdf' });
}
