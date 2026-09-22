import { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString, PDFString, PDFStream, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import type { Annotation } from './annotations/models';
import type { DocumentNote } from '@/core/notes/models';
import { addPdfAnnotations } from './pdf-annotations';

const EMBEDDED_FILE_NAME = 'pdf-reader-annotations.json';

function removePreviousAttachment(pdfDoc: PDFDocument) {
    const names = pdfDoc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    const embeddedFiles = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
    const entries = embeddedFiles?.lookupMaybe(PDFName.of('Names'), PDFArray);
    if (!entries) return;
    for (let index = entries.size() - 2; index >= 0; index -= 2) {
        const name = entries.lookup(index);
        if ((name instanceof PDFString || name instanceof PDFHexString)
            && name.decodeText() === EMBEDDED_FILE_NAME) {
            entries.remove(index);
            entries.remove(index);
        }
    }
}

/**
 * Embeds the annotation model into the PDF as a hidden file attachment.
 * This ensures the annotations are "portable" (travel with the file)
 * and can be re-edited when opened in this application.
 */
export async function embedAnnotations(pdfDoc: PDFDocument, annotations: Annotation[], notes: DocumentNote[] = []): Promise<void> {
    try {
        addPdfAnnotations(pdfDoc, annotations);
        removePreviousAttachment(pdfDoc);
        const jsonString = JSON.stringify({ schemaVersion: 3, objects: annotations, notes });
        const uint8Array = new TextEncoder().encode(jsonString);

        await pdfDoc.attach(uint8Array, EMBEDDED_FILE_NAME, {
            mimeType: 'application/json',
            description: 'Editable annotation data for Margin',
            creationDate: new Date(),
            modificationDate: new Date(),
        });

        console.log('[PDFDataManager] Embedded annotations into PDF attachment');
    } catch (e) {
        console.error('[PDFDataManager] Failed to embed annotations', e);
        // Do not throw, treating this as non-fatal fallback
    }
}

/**
 * Extracts embedded annotation data from a file if present.
 * Uses low-level pdf-lib access as getAttachments() is not available in all versions.
 */
export async function extractAnnotationData(file: File): Promise<{ annotations: Annotation[]; notes: DocumentNote[] } | null> {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuffer);

        // 1. Get Catalog
        const catalog = pdfDoc.catalog;

        // 2. Get Names Dictionary
        const names = catalog.lookup(PDFName.of('Names'), PDFDict);
        if (!names) return null;

        // 3. Get EmbeddedFiles
        const embeddedFiles = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict);
        if (!embeddedFiles) return null;

        // 4. Get Names Array
        const efNames = embeddedFiles.lookup(PDFName.of('Names'), PDFArray);
        if (!efNames) return null;

        // 5. Iterate through Names to find our file
        for (let i = 0; i < efNames.size(); i += 2) {
            const fileName = efNames.lookup(i) as PDFString;
            if (fileName.decodeText() === EMBEDDED_FILE_NAME) {
                const fileSpec = efNames.lookup(i + 1, PDFDict) as PDFDict;
                const efDict = fileSpec.lookup(PDFName.of('EF'), PDFDict) as PDFDict;
                const embeddedFileStream = efDict.lookup(PDFName.of('F'), PDFStream);

                if (embeddedFileStream instanceof PDFStream) {
                    const bytes = embeddedFileStream instanceof PDFRawStream
                        ? decodePDFRawStream(embeddedFileStream).decode()
                        : embeddedFileStream.getContents();
                    // Basic check to avoid parsing binary trash if something is wrong
                    if (bytes.length > 0) {
                        try {
                            const jsonString = new TextDecoder().decode(bytes);
                            const parsed = JSON.parse(jsonString);
                            if (Array.isArray(parsed)) {
                                console.log('[PDFDataManager] Extracted embedded annotations:', parsed.length);
                                return { annotations: parsed, notes: [] };
                            }
                            if (parsed && Array.isArray(parsed.objects)) {
                                return {
                                    annotations: parsed.objects,
                                    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
                                };
                            }
                        } catch (e) {
                            console.warn('[PDFDataManager] Found attachment but failed to parse JSON:', e);
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn('[PDFDataManager] Failed to extract annotations or none found', e);
    }
    return null;
}

export async function extractAnnotations(file: File): Promise<Annotation[] | null> {
    return (await extractAnnotationData(file))?.annotations ?? null;
}
