import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createInitialPageDocument, materializePageDocument } from './pdf-pages';

describe('PDF page materialization', () => {
    it('reorders, rotates, and adds blank pages from immutable sources', async () => {
        const source = await PDFDocument.create();
        source.addPage([100, 200]);
        source.addPage([300, 400]);
        const sourceBytes = await source.save();
        const initial = await createInitialPageDocument(sourceBytes);
        const document = {
            ...initial,
            pages: [
                { ...initial.pages[1], rotation: 90 as const },
                { id: 'blank', kind: 'blank' as const, width: 612, height: 792, rotation: 0 as const },
                initial.pages[0],
            ],
        };
        const outputBytes = await materializePageDocument(document, async () => sourceBytes);
        const output = await PDFDocument.load(outputBytes);
        expect(output.getPageCount()).toBe(3);
        expect(output.getPage(0).getSize()).toEqual({ width: 300, height: 400 });
        expect(output.getPage(0).getRotation().angle).toBe(90);
        expect(output.getPage(1).getSize()).toEqual({ width: 612, height: 792 });
    });
});

