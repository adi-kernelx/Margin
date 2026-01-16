
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { tsClient, qClient } from '../lib/search';
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { s3, S3_BUCKET } from '../lib/storage';
import { GetObjectCommand } from '@aws-sdk/client-s3';

const router = Router();
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'ap-south-1' });

// --- Helpers ---

async function getKeywordCandidates(query: string, userId: string, docIds?: string[], limit = 50): Promise<string[]> {
    const filters = [`userId:=${userId}`];
    if (docIds && docIds.length > 0) {
        filters.push(`docId:=[${docIds.join(',')}]`);
    }

    try {
        const searchResult = await tsClient.collections('pdf_chunks').documents().search({
            q: query,
            query_by: 'text',
            filter_by: filters.join(' && '),
            per_page: limit,
            include_fields: 'chunkId'
        });

        return searchResult.hits?.map(h => (h.document as any)['chunkId'] as string) || [];
    } catch (e) {
        console.warn("Typesense search failed, falling back to pure vector:", e);
        return []; // Fallback empty implies "search everything" logic downstream?
        // Requirement says: "If Typesense returns empty: fallback to pure vector search."
        // So returning empty list here is fine, we handle it in Step 3.
    }
}

async function embedQuery(query: string): Promise<number[]> {
    // Bedrock Titan Embed Text v1
    const command = new InvokeModelCommand({
        modelId: "amazon.titan-embed-text-v1",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({ inputText: query })
    });

    const response = await bedrock.send(command);
    // response.body is Uint8Array
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return responseBody.embedding;
}

async function qdrantSearch(queryVec: number[], candidateIds: string[], userId: string, docIds?: string[], limit = 10) {
    // Filter Construction
    const mustFilters: any[] = [
        { key: "userId", match: { value: userId } }
    ];

    if (docIds && docIds.length > 0) {
        mustFilters.push({ key: "docId", match: { any: docIds } });
    }

    // Hybrid Filter: Restrict to Typesense candidates IF they exist
    if (candidateIds.length > 0) {
        mustFilters.push({ key: "id", match: { any: candidateIds } }); // Qdrant uses 'id' for point ID
    }

    const filter = { must: mustFilters };

    return qClient.search('pdf_chunks', {
        vector: queryVec,
        filter,
        limit,
        with_payload: true
    });
}

async function hydrateResults(hits: any[], userId: string) {
    // Optimization: Group by Sidecar Key to reduce S3 calls
    // Map sidecarKey -> { promise, chunks: Map<chunkId, hit> }

    const sidecarMap = new Map<string, any[]>();

    for (const hit of hits) {
        const payload = hit.payload;
        // Construct key if not in payload (it might be missing in older upserts)
        const sidecarKey = payload.sidecarKey ||
            `users/${userId}/docs/${payload.docId}/ocr/page-${String(payload.page).padStart(4, '0')}.json`;

        if (!sidecarMap.has(sidecarKey)) {
            sidecarMap.set(sidecarKey, []);
        }
        sidecarMap.get(sidecarKey)!.push({ hit, sidecarKey });
    }

    const results: any[] = [];

    // Parallel Fetch
    await Promise.all(Array.from(sidecarMap.entries()).map(async ([key, items]) => {
        try {
            const s3Res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
            const bodyStr = await s3Res.Body?.transformToString();
            if (!bodyStr) return;
            const sidecar = JSON.parse(bodyStr);

            for (const item of items) {
                const { hit } = item;
                // Find chunk
                const chunk = sidecar.chunks.find((c: any) => c.chunkId === hit.id);
                if (chunk) {
                    results.push({
                        chunkId: hit.id,
                        docId: hit.payload.docId,
                        page: chunk.pageRange ? chunk.pageRange[0] : hit.payload.page,
                        score: hit.score,
                        text: chunk.textPreview || chunk.fullText || hit.payload.text, // Fallbacks
                        bbox: chunk.bbox,
                        sidecarKey: key
                    });
                }
            }
        } catch (e) {
            console.error(`Failed to hydrate from ${key}:`, e);
            // Partial failure currently ignored, result dropped
        }
    }));

    // Re-sort by score (parallel fetch scrambles order)
    return results.sort((a, b) => b.score - a.score);
}

// --- Handler ---

router.post('/search', requireAuth, async (req, res) => {
    try {
        const { query, docIds, limit = 10 } = req.body;
        const userId = req.user!.uid;

        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        // 1. Keyword Candidates (Typesense)
        const candidates = await getKeywordCandidates(query, userId, docIds, 50);

        // 2. Embed Query (Bedrock)
        const queryVec = await embedQuery(query);

        // 3. Vector Rerank (Qdrant)
        // If candidates is empty, we search EVERYTHING (hybrid fallback) or NOTHING?
        // Requirement: "If Typesense returns empty: fallback to pure vector search."
        // My qdrantSearch function handles empty candidates by NOT adding the ID filter. Perfect.

        const hits = await qdrantSearch(queryVec, candidates, userId, docIds, limit);

        // 4. Hydrate (S3)
        const results = await hydrateResults(hits, userId);

        res.json({ results });

    } catch (err: any) {
        console.error("Search Error:", err);
        res.status(500).json({ error: 'Search failed', details: err.message });
    }
});

export default router;
