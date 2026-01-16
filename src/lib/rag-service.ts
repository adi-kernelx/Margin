export interface QueryScope {
    docIds?: string[];
    pages?: number[];
    selection?: {
        page: number;
        bbox: [number, number, number, number];
        text: string;
    };
}

export interface QueryRequest {
    question: string;
    mode?: 'qa' | 'summary' | 'compare' | 'explain' | 'extract';
    scope?: QueryScope;
    sessionId?: string;
}

export interface Source {
    docId: string;
    page: number;
    text: string;
    score: number;
}

export interface QueryResponse {
    answer: string;
    confidence: number;
    sources: Source[];
    metrics: Record<string, number>;
}

const RAG_API_URL = 'http://localhost:9101';

export async function queryRag(req: QueryRequest): Promise<QueryResponse> {
    const res = await fetch(`${RAG_API_URL}/query`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(req),
    });

    if (!res.ok) {
        throw new Error(`RAG Query failed: ${res.statusText}`);
    }

    return res.json();
}

export function createSessionId(): string {
    return self.crypto.randomUUID();
}
