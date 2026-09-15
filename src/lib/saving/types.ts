
import type { AnnotationData } from '../../types/editor-types';

export type SaveReason =
    | 'manual'
    | 'autosave'
    | 'flatten'
    | 'save-as'
    | 'recovery'
    | 'export'
    | 'download-package';

export interface SaveJob {
    reason: SaveReason;
    payload: AnnotationData;
    requestedAt: number;
    /** Current materialized PDF after page operations. Only populated for PDF exports. */
    pdfBytes?: Uint8Array;
}

export type SaveResult = {
    success: boolean;
    error?: string;
};

export interface SaveAdapter {
    save(job: SaveJob): Promise<void>;
    flatten?(job: SaveJob): Promise<void>;
}

export type SaveInit = {
    adapter: SaveAdapter;
};
