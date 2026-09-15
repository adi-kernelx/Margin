import { degrees, PDFDocument } from 'pdf-lib';
import { createPageDocument, normalizeRotation } from '@/core/pages/document';
import type { PageDocument, PageRecord } from '@/core/pages/models';

export type PageSourceLoader = (sourceId: string) => Promise<Uint8Array | null>;

export async function describePdfSource(bytes: Uint8Array, sourceId: string): Promise<PageRecord[]> {
    const source = await PDFDocument.load(bytes);
    return source.getPages().map((page, sourcePageIndex) => {
        const { width, height } = page.getSize();
        return {
            id: crypto.randomUUID(),
            kind: 'pdf' as const,
            sourceId,
            sourcePageIndex,
            width,
            height,
            rotation: normalizeRotation(page.getRotation().angle),
        };
    });
}

export async function createInitialPageDocument(bytes: Uint8Array, sourceId = 'original'): Promise<PageDocument> {
    return createPageDocument(await describePdfSource(bytes, sourceId));
}

export async function materializePageDocument(
    document: PageDocument,
    loadSource: PageSourceLoader,
): Promise<Uint8Array> {
    const output = await PDFDocument.create();
    const sources = new Map<string, PDFDocument>();

    for (const record of document.pages) {
        if (record.kind === 'blank') {
            const page = output.addPage([record.width, record.height]);
            page.setRotation(degrees(record.rotation));
            continue;
        }

        let source = sources.get(record.sourceId);
        if (!source) {
            const bytes = await loadSource(record.sourceId);
            if (!bytes) throw new Error(`Missing local page source: ${record.sourceId}`);
            source = await PDFDocument.load(bytes);
            sources.set(record.sourceId, source);
        }
        if (record.sourcePageIndex < 0 || record.sourcePageIndex >= source.getPageCount()) {
            throw new Error(`Invalid source page ${record.sourcePageIndex} in ${record.sourceId}`);
        }
        const [page] = await output.copyPages(source, [record.sourcePageIndex]);
        page.setRotation(degrees(record.rotation));
        output.addPage(page);
    }

    return output.save();
}

export async function exportPageRecords(
    pages: PageRecord[],
    loadSource: PageSourceLoader,
): Promise<Uint8Array> {
    if (pages.length === 0) throw new Error('Select at least one page');
    return materializePageDocument(createPageDocument(pages), loadSource);
}

export function downloadPdf(bytes: Uint8Array, filename: string): void {
    const blob = new Blob([bytes.slice().buffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

