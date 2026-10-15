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

import type { AssistantSource } from '@/core/assistant/conversation';

export type Source = AssistantSource;

export interface QueryResponse {
    answer: string;
    confidence: number;
    sources: Source[];
    metrics: Record<string, number>;
}

const RAG_API_URL = 'http://localhost:9101';

export async function queryRag(req: QueryRequest, signal?: AbortSignal): Promise<QueryResponse> {
    const res = await fetch(`${RAG_API_URL}/query`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(req),
        signal,
    });

    if (!res.ok) {
        throw new Error(`RAG Query failed: ${res.statusText}`);
    }

    return res.json();
}

export function createSessionId(): string {
    return self.crypto.randomUUID();
}
