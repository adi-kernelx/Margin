export type PageId = string;

export type PageRotation = 0 | 90 | 180 | 270;

export interface PdfPageRecord {
    id: PageId;
    kind: 'pdf';
    sourceId: string;
    sourcePageIndex: number;
    width: number;
    height: number;
    rotation: PageRotation;
}

export interface BlankPageRecord {
    id: PageId;
    kind: 'blank';
    width: number;
    height: number;
    rotation: PageRotation;
}

export type PageRecord = PdfPageRecord | BlankPageRecord;

export interface PageDocument {
    schemaVersion: 1;
    pages: PageRecord[];
}

export type PageOperation =
    | { type: 'add-page'; data: { page: PageRecord; index: number } }
    | { type: 'delete-page'; data: { pageId: PageId } }
    | { type: 'move-page'; data: { pageId: PageId; toIndex: number } }
    | { type: 'rotate-page'; data: { pageId: PageId; rotation: PageRotation } };

