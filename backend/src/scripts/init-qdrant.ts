
import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

const client = new QdrantClient({ url: QDRANT_URL, apiKey: QDRANT_API_KEY });

async function main() {
    console.log(`Connecting to Qdrant at ${QDRANT_URL}...`);
    try {
        const result = await client.getCollections();
        const exists = result.collections.some(c => c.name === 'pdf_chunks');

        if (!exists) {
            console.log("Creating collection 'pdf_chunks'...");
            await client.createCollection('pdf_chunks', {
                vectors: {
                    size: 1536,
                    distance: 'Cosine'
                }
            });
            console.log("Collection created.");
        } else {
            console.log("Collection 'pdf_chunks' already exists.");
        }
    } catch (e) {
        console.error("Failed to init Qdrant:", e);
    }
}

main();
