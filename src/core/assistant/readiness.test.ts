import { describe, expect, it } from 'vitest';
import { assistantReadiness, parseModelStatus } from './readiness';

describe('parseModelStatus', () => {
    it('reads the model fields of /health', () => {
        expect(parseModelStatus({ status: 'ok', llm: 'missing', model: 'qwen2.5:3b-instruct' }))
            .toEqual({ state: 'missing', name: 'qwen2.5:3b-instruct' });
    });

    it('treats an older or malformed reply as unknown', () => {
        expect(parseModelStatus({ status: 'ok' })).toEqual({ state: 'unknown', name: null });
        expect(parseModelStatus(null)).toEqual({ state: 'unknown', name: null });
        expect(parseModelStatus({ llm: 'broken', model: 3 })).toEqual({ state: 'unknown', name: null });
    });
});

describe('assistantReadiness', () => {
    const online = { state: 'online' as const, name: 'qwen2.5:3b-instruct' };

    it('is ready only when the service and the model are up', () => {
        expect(assistantReadiness('online', online)).toEqual({ ready: true });
        expect(assistantReadiness('online', { state: 'unknown', name: null }).ready).toBe(true);
        expect(assistantReadiness('checking', online)).toEqual({ ready: false });
    });

    it('names what to fix', () => {
        expect(assistantReadiness('offline', online).description).toContain('npm run assistant');
        expect(assistantReadiness('online', { ...online, state: 'offline' }).title).toBe('Ollama is not running');
        expect(assistantReadiness('online', { ...online, state: 'missing' }).description)
            .toContain('ollama pull qwen2.5:3b-instruct');
    });
});
