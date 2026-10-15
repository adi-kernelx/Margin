import { conceptIndexRequest, type ConceptRecord, type KnowledgeBundle } from '@/core/knowledge/okf';

const RAG_API_URL = 'http://localhost:9101';

/** Document kinds the bundle classifier was trained with; it uses the kind as a feature. */
export const DOCUMENT_CATEGORIES = ['paper', 'textbook', 'slides', 'notes', 'thesis', 'standard', 'assignment', 'solutions'] as const;
export type DocumentCategory = typeof DOCUMENT_CATEGORIES[number];

/** The local reader's actor id in OKF `verified` entries. Margin is single-user, so one id suffices. */
export const LOCAL_ACTOR = 'human:local';

interface BundleResponse {
    fingerprint: string;
    fileName: string;
    summary: KnowledgeBundle['summary'];
    files: { path: string; content: string }[];
    concepts: ConceptRecord[];
}

export class KnowledgeServiceError extends Error {
    readonly unreachable: boolean;

    constructor(message: string, unreachable = false) {
        super(message);
        this.unreachable = unreachable;
    }
}

/** Sends the original PDF bytes to the local RAG service and returns the built bundle. */
export async function buildBundle(
    documentId: string, bytes: Uint8Array, fileName: string, category: DocumentCategory, signal?: AbortSignal,
): Promise<KnowledgeBundle> {
    const form = new FormData();
    form.append('file', new Blob([bytes.slice()], { type: 'application/pdf' }), fileName);
    form.append('category', category);
    let response: Response;
    try {
        response = await fetch(`${RAG_API_URL}/bundle`, { method: 'POST', body: form, signal });
    } catch (error) {
        if ((error as Error).name === 'AbortError') throw error;
        throw new KnowledgeServiceError('The local RAG service is not running on port 9101.', true);
    }
    if (!response.ok) {
        let detail = response.statusText;
        try {
            detail = (await response.json()).detail ?? detail;
        } catch {
            // Keep the status text.
        }
        throw new KnowledgeServiceError(`Building knowledge failed: ${detail}`);
    }
    const body = await response.json() as BundleResponse;
    return {
        documentId,
        fingerprint: body.fingerprint,
        fileName: body.fileName,
        builtAt: new Date().toISOString(),
        summary: body.summary,
        files: Object.fromEntries(body.files.map(file => [file.path, file.content])),
        concepts: body.concepts,
    };
}

/**
 * Sends the bundle's concepts, with the reader's verifications, to the RAG
 * service so the assistant can retrieve and cite them. Best effort: the panel
 * works without the service, and the next build or verification resends.
 */
export async function indexConcepts(bundle: KnowledgeBundle): Promise<boolean> {
    try {
        const response = await fetch(`${RAG_API_URL}/concepts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(conceptIndexRequest(bundle)),
        });
        return response.ok;
    } catch {
        return false;
    }
}
