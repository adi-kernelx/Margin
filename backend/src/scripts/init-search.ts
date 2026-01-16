
/**
 * Init Search Indices (Typesense)
 * Usage: npx ts-node src/scripts/init-search.ts
 */

import { Client } from 'typesense';

const TYPESENSE_CONFIG = {
    nodes: [{
        host: process.env.TYPESENSE_HOST || 'localhost',
        port: parseInt(process.env.TYPESENSE_PORT || '8108'),
        protocol: process.env.TYPESENSE_PROTOCOL || 'http'
    }],
    apiKey: process.env.TYPESENSE_API_KEY || 'my-secret-typesense-key',
    connectionTimeoutSeconds: 5
};

const tsClient = new Client(TYPESENSE_CONFIG);

async function main() {
    console.log('Initializing Typesense Collection...');
    const schema = {
        name: 'pdf_chunks',
        fields: [
            { name: 'chunkId', type: 'string' as const },
            { name: 'docId', type: 'string' as const, facet: true },
            { name: 'userId', type: 'string' as const, facet: true },
            { name: 'page', type: 'int32' as const, facet: true },
            { name: 'text', type: 'string' as const },
            { name: 'confidence', type: 'float' as const },
            { name: 'createdAt', type: 'int64' as const },
            // Optional: for tracking vector status
            { name: 'indexedVectors', type: 'bool' as const, optional: true }
        ],
        default_sorting_field: 'createdAt'
    };

    try {
        await tsClient.collections('pdf_chunks').retrieve();
        console.log('Collection pdf_chunks already exists.');
        // Optional: Delete and recreate if schema changes needed
        // await tsClient.collections('pdf_chunks').delete();
        // await tsClient.collections().create(schema);
    } catch (err: any) {
        if (err.httpStatus === 404) {
            await tsClient.collections().create(schema);
            console.log('Created collection: pdf_chunks');
        } else {
            console.error('Error checking collection:', err);
        }
    }
}

main();
