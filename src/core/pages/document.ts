import type { Annotation, Operation } from '@/core/annotations/models';
import type { PageDocument, PageOperation, PageRecord, PageRotation } from './models';

const clampIndex = (index: number, length: number) => Math.max(0, Math.min(Math.trunc(index), length));

export function createPageDocument(pages: PageRecord[]): PageDocument {
    const ids = new Set<string>();
    for (const page of pages) {
        if (ids.has(page.id)) throw new Error(`Duplicate page id: ${page.id}`);
        ids.add(page.id);
    }
    return { schemaVersion: 1, pages: [...pages] };
}

export function pageDocumentRevision(document: PageDocument): string {
    return `pages:${document.pages.map(page => `${page.id}@${page.rotation}`).join(',')}`;
}

export function applyPageOperation(document: PageDocument, operation: PageOperation): PageDocument {
    const pages = [...document.pages];

    switch (operation.type) {
        case 'add-page': {
            if (pages.some(page => page.id === operation.data.page.id)) return document;
            pages.splice(clampIndex(operation.data.index, pages.length), 0, operation.data.page);
            break;
        }
        case 'delete-page': {
            if (pages.length <= 1) return document;
            const index = pages.findIndex(page => page.id === operation.data.pageId);
            if (index < 0) return document;
            pages.splice(index, 1);
            break;
        }
        case 'move-page': {
            const fromIndex = pages.findIndex(page => page.id === operation.data.pageId);
            if (fromIndex < 0) return document;
            const [page] = pages.splice(fromIndex, 1);
            pages.splice(clampIndex(operation.data.toIndex, pages.length), 0, page);
            break;
        }
        case 'rotate-page': {
            const index = pages.findIndex(page => page.id === operation.data.pageId);
            if (index < 0) return document;
            pages[index] = { ...pages[index], rotation: operation.data.rotation };
            break;
        }
    }

    return createPageDocument(pages);
}

export function applyOperationToPageDocument(document: PageDocument, operation: Operation): PageDocument {
    if (operation.type === 'batch') {
        return operation.data.operations.reduce(applyOperationToPageDocument, document);
    }
    if (
        operation.type === 'add-page'
        || operation.type === 'delete-page'
        || operation.type === 'move-page'
        || operation.type === 'rotate-page'
    ) {
        return applyPageOperation(document, operation);
    }
    return document;
}

export function normalizeRotation(rotation: number): PageRotation {
    const normalized = ((rotation % 360) + 360) % 360;
    if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
    return 0;
}

export function rotateBy(rotation: PageRotation, delta: 90 | -90): PageRotation {
    return normalizeRotation(rotation + delta);
}

export function attachAnnotationsToPageIds(
    annotations: Annotation[],
    document: PageDocument,
): Annotation[] {
    return annotations.map(annotation => {
        const currentIndex = annotation.pageId
            ? document.pages.findIndex(page => page.id === annotation.pageId)
            : -1;
        if (annotation.pageId && currentIndex < 0) return annotation;
        const pageIndex = currentIndex >= 0 ? currentIndex : annotation.pageNum - 1;
        const page = document.pages[pageIndex];
        if (!page) return annotation;
        if (annotation.pageId === page.id && annotation.pageNum === pageIndex + 1) return annotation;
        return {
            ...annotation,
            pageId: page.id,
            pageNum: pageIndex + 1,
            ...(annotation.type === 'highlight' && annotation.note
                ? { note: { ...annotation.note, pageId: page.id } }
                : {}),
        };
    });
}

export function annotationsForExistingPages(
    annotations: Annotation[],
    document: PageDocument,
): Annotation[] {
    const ids = new Set(document.pages.map(page => page.id));
    return annotations.filter(annotation => !annotation.pageId || ids.has(annotation.pageId));
}
