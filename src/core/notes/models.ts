import type { BoundingBox } from '@/core/annotations/models';

export interface NoteAnchor {
    id: string;
    highlightId: string;
    pageNum: number;
    pageId?: string;
    quote: string;
    prefix: string;
    suffix: string;
    bbox: BoundingBox;
}

/** A note is independent from highlights and can reference any number of them. */
export interface DocumentNote {
    id: string;
    body: string;
    anchors: NoteAnchor[];
    createdAt: number;
    updatedAt: number;
}
