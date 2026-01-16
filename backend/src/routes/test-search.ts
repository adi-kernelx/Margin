
import { Router } from 'express';
import { tsClient, qClient } from '../lib/search';

const router = Router();

// GET /api/test-search/health
router.get('/health', async (req, res) => {
    let tsStatus = { connected: false, details: null as any };
    let qStatus = { connected: false, details: null as any };

    // Check Typesense
    try {
        const tsHealth = await tsClient.health.retrieve();
        tsStatus = { connected: tsHealth.ok, details: tsHealth };
    } catch (err: any) {
        tsStatus.details = err.message;
    }

    // Check Qdrant
    try {
        const qCollections = await qClient.getCollections();
        qStatus = {
            connected: true,
            details: { collections: qCollections.collections.map(c => c.name) }
        };
    } catch (err: any) {
        qStatus.details = err.message;
    }

    res.json({
        status: (tsStatus.connected && qStatus.connected) ? 'ok' : 'partial',
        typesense: tsStatus,
        qdrant: qStatus
    });
});

// POST /api/test-search/seed
// Insert a dummy vector+text
router.post('/seed', async (req, res) => {
    try {
        const chunkId = '550e8400-e29b-41d4-a716-446655440000'; // Valid UUID
        const docId = 'test-doc-123';
        const text = 'This is a test sentence for vector search validation.';
        const vector = Array(1536).fill(0.1);

        // 0. Ensure Typesense Collection
        try {
            await tsClient.collections('pdf_chunks').retrieve();
        } catch (e: any) {
            if (e.httpStatus === 404) {
                await tsClient.collections().create({
                    name: 'pdf_chunks',
                    fields: [
                        { name: 'docId', type: 'string', facet: true },
                        { name: 'text', type: 'string' },
                        { name: 'page', type: 'int32' },
                        { name: 'userId', type: 'string', facet: true }
                    ]
                });
            } else {
                throw e;
            }
        }

        // 0. Ensure Qdrant Collection
        try {
            await qClient.getCollection('pdf_chunks');
        } catch (e) {
            await qClient.createCollection('pdf_chunks', {
                vectors: { size: 1536, distance: 'Cosine' }
            });
        }

        // 1. Typesense Upsert
        await tsClient.collections('pdf_chunks').documents().upsert({
            id: chunkId,
            chunkId,
            docId,
            text,
            page: 1,
            userId: 'test-user'
        });

        // 2. Qdrant Upsert
        await qClient.upsert('pdf_chunks', {
            points: [{
                id: chunkId,
                vector,
                payload: { docId, text, page: 1 }
            }]
        });

        res.json({ success: true, message: 'Seeded test chunk' });


    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/test-search/query?q=...
router.get('/query', async (req, res) => {
    try {
        const q = req.query.q as string || "test";

        // Keyword Search
        const tsResult = await tsClient.collections('pdf_chunks').documents().search({
            q,
            query_by: 'text'
        });

        // Vector Search (Mock vector for query)
        const vector = Array(1536).fill(0.1);
        const qResult = await qClient.search('pdf_chunks', {
            vector,
            limit: 5
        });

        res.json({
            keyword_hits: tsResult.hits?.length,
            vector_hits: qResult.length,
            results: {
                keyword: tsResult.hits,
                vector: qResult
            }
        });

    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
