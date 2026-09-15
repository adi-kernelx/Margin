import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { makeShape, makeStroke } from '@/core/annotations/test-factories';
import type { HighlightAnnotation, TextAnnotation } from '@/core/annotations/models';
import { addPdfAnnotations } from './pdf-annotations';
import { embedAnnotations } from './pdf-data-manager';

describe('PDF annotation export', () => {
    it('writes standard annotations that survive a PDF round trip', async () => {
        const pdf = await PDFDocument.create();
        pdf.addPage([600, 800]);
        const highlight: HighlightAnnotation = {
            id: 'highlight', type: 'highlight', pageNum: 1, createdAt: 1, updatedAt: 1,
            zIndex: 1, locked: false, style: { color: '#ffcc00', opacity: 0.35 },
            meta: { tool: 'highlight' }, geometry: {
                mode: 'text-aware', rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
            },
        };
        const text: TextAnnotation = {
            id: 'text', type: 'text', pageNum: 1, createdAt: 1, updatedAt: 1,
            zIndex: 2, locked: false, style: { color: '#000000', opacity: 1, fontSize: 14 },
            meta: { tool: 'text' }, geometry: {
                boundingBox: { x: 0.2, y: 0.4, width: 0.3, height: 0.1 },
            }, content: 'A portable note',
        };
        const stroke = { ...makeStroke([{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.3 }]), pageNum: 1 };
        const shape = { ...makeShape({ x: 0.5, y: 0.5, width: 0.2, height: 0.15 }), pageNum: 1 };

        addPdfAnnotations(pdf, [highlight, text, stroke, shape]);
        addPdfAnnotations(pdf, [highlight, text, stroke, shape]);
        const loaded = await PDFDocument.load(await pdf.save());
        const annots = loaded.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
        const subtypes = Array.from({ length: annots.size() }, (_, index) =>
            annots.lookup(index, PDFDict).lookup(PDFName.of('Subtype'), PDFName).asString());

        expect(subtypes).toEqual(['/Highlight', '/FreeText', '/Ink', '/Square']);
    });

    it('replaces Margin metadata instead of accumulating stale attachments', async () => {
        const pdf = await PDFDocument.create();
        pdf.addPage();
        await embedAnnotations(pdf, []);
        const reopened = await PDFDocument.load(await pdf.save());
        await embedAnnotations(reopened, []);

        const loaded = await PDFDocument.load(await reopened.save());
        const names = loaded.catalog.lookup(PDFName.of('Names'), PDFDict);
        const embedded = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict);
        const entries = embedded.lookup(PDFName.of('Names'), PDFArray);
        expect(entries.size()).toBe(2);
    });
});
