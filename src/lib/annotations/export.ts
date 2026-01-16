import type { Annotation } from './models';
import { annotationStorage } from './storage';

export interface AnnotationExport {
    version: '1.0';
    fileId: string;
    fileName: string;
    exportedAt: number;
    pages: {
        [pageNum: number]: Annotation[];
    };
}

/**
 * Export annotations to JSON format
 */
export async function exportAnnotationsJSON(
    fileId: string,
    fileName: string
): Promise<Blob> {
    const annotations = await annotationStorage.getAnnotationsByFile(fileId);

    // Group annotations by page
    const pages: { [pageNum: number]: Annotation[] } = {};

    for (const annotation of annotations) {
        const pageNum = annotation.pageNum;
        if (!pages[pageNum]) {
            pages[pageNum] = [];
        }
        pages[pageNum].push(annotation);
    }

    const exportData: AnnotationExport = {
        version: '1.0',
        fileId,
        fileName,
        exportedAt: Date.now(),
        pages,
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    return new Blob([jsonString], { type: 'application/json' });
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


