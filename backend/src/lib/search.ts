/**
 * Search Client Adapter (Qdrant + Typesense)
 */
import { Client as TypesenseClient } from 'typesense';
import { QdrantClient } from '@qdrant/js-client-rest';

const TYPESENSE_CONFIG = {
    nodes: [{
        host: process.env.TYPESENSE_HOST || 'localhost',
        port: parseInt(process.env.TYPESENSE_PORT || '8108'),
        protocol: process.env.TYPESENSE_PROTOCOL || 'http'
    }],
    apiKey: process.env.TYPESENSE_API_KEY || 'my-secret-typesense-key',
    connectionTimeoutSeconds: 10
};

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || 'my-secret-qdrant-key';

export const tsClient = new TypesenseClient(TYPESENSE_CONFIG);
export const qClient = new QdrantClient({ url: QDRANT_URL, apiKey: QDRANT_API_KEY });


export async function searchKeyword(query: string, filterBy: string) {
    return tsClient.collections('pdf_chunks').documents().search({
        q: query,
        query_by: 'text',
        filter_by: filterBy // e.g. "docId:xyz"
    });
}

export async function searchSemantic(vector: number[], filterDocId?: string) {
    const filter = filterDocId ? {
        must: [{ key: "docId", match: { value: filterDocId } }]
    } : undefined;

    return qClient.search('pdf_chunks', {
        vector,
        filter,
        limit: 10
    });
}

// -- Wrappers for Pipeline --

/**
 * Stage A: Upsert chunk metadata & text to Typesense
 */
export async function upsertChunkToTypesense(chunk: any) {
    return tsClient.collections('pdf_chunks').documents().upsert({
        id: chunk.chunkId,
        ...chunk,
        indexedVectors: false
    });
}

/**
 * Stage B: Mark chunk as 'vectorized' in Typesense
 */
export async function markChunkAsVectorized(chunkId: string) {
    return tsClient.collections('pdf_chunks').documents(chunkId).update({
        indexedVectors: true
    });
}
