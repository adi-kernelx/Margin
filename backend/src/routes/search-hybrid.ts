import { Router } from 'express';
import { searchKeyword } from '../lib/search';

const router = Router();

router.post('/search', async (req, res) => {
    try {
        const { query, limit = 10, docIds } = req.body;

        if (!query) {
            return res.status(400).json({ error: 'Missing query' });
        }

        let filterBy = '';
        if (docIds && Array.isArray(docIds) && docIds.length > 0) {
            // Typesense filter syntax for exact match array
            const formattedIds = docIds.map(id => `\`${id}\``).join(',');
            filterBy = `docId:=[${formattedIds}]`;
        }

        const results = await searchKeyword(query, filterBy);

        // Map Typesense results back to expected SearchResult format
        const mappedResults = results.hits?.map((hit: any) => ({
            id: hit.document.chunkId || hit.document.id,
            docId: hit.document.docId,
            page: hit.document.page || 1,
            text: hit.document.text,
            bbox: hit.document.bbox || [0,0,0,0],
            score: hit.text_match,
            spans: hit.document.spans || []
        })) || [];

        res.json({ results: mappedResults });
    } catch (error: any) {
        console.error('Search error:', error);
        res.status(500).json({ error: error.message || 'Search failed' });
    }
});

export default router;
