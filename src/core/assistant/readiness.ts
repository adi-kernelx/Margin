// Whether the assistant can answer, from the RAG service's /health reply.
// The service can be up while its language model (Ollama) is not, so the two
// are reported separately and the panel says which one to fix.

export type ServiceState = 'online' | 'offline' | 'checking';

/** `unknown`: an older service that does not report its model. */
export type ModelState = 'online' | 'offline' | 'missing' | 'unknown';

export interface ModelStatus {
    state: ModelState;
    name: string | null;
}

export interface Readiness {
    ready: boolean;
    title?: string;
    description?: string;
}

export function parseModelStatus(body: unknown): ModelStatus {
    const record = (body && typeof body === 'object' ? body : {}) as { llm?: unknown; model?: unknown };
    const state = record.llm === 'online' || record.llm === 'offline' || record.llm === 'missing' ? record.llm : 'unknown';
    return { state, name: typeof record.model === 'string' ? record.model : null };
}

export function assistantReadiness(service: ServiceState, model: ModelStatus): Readiness {
    if (service === 'offline') {
        return {
            ready: false,
            title: 'Assistant service is not running',
            description: 'Run "npm run assistant" in the project folder and open Ollama. Reading and annotating keep working without it.',
        };
    }
    if (service === 'checking') return { ready: false };
    if (model.state === 'offline') {
        return {
            ready: false,
            title: 'Ollama is not running',
            description: 'Open the Ollama app. The assistant needs it to write answers.',
        };
    }
    if (model.state === 'missing') {
        return {
            ready: false,
            title: 'Model not installed',
            description: `Run "ollama pull ${model.name ?? 'qwen2.5:3b-instruct'}" once, then ask again.`,
        };
    }
    return { ready: true };
}
