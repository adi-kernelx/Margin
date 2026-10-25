import { describe, expect, it } from 'vitest';
import { formatDuration, formatRate, readAnswerStats, statsRows, statsSummary } from './stats';

const metrics = {
    mode: 'grounded', grounding_score: 0.8, llm_model: 'qwen2.5:3b-instruct',
    prompt_tokens: 1200, output_tokens: 210, prompt_tps: 80, output_tps: 7,
    load_ms: 2500, prompt_ms: 15000, generation_ms: 30000,
    retrieval_ms: 110, rerank_ms: 820, total_ms: 48600, sources: 8, context_window: 8192,
    truncated: false,
};

describe('readAnswerStats', () => {
    it('maps the service metrics', () => {
        expect(readAnswerStats(metrics)).toMatchObject({
            model: 'qwen2.5:3b-instruct', promptTokens: 1200, outputTokens: 210, promptTps: 80, outputTps: 7,
            retrievalMs: 110, rerankMs: 820, totalMs: 48600, sources: 8, contextWindow: 8192,
        });
        expect(readAnswerStats(metrics)?.truncated).toBeUndefined();
    });

    it('ignores replies without numbers', () => {
        expect(readAnswerStats({ mode: 'error' })).toBeUndefined();
        expect(readAnswerStats(null)).toBeUndefined();
        expect(readAnswerStats({ output_tokens: 'many', total_ms: Number.NaN })).toBeUndefined();
    });
});

describe('formatting', () => {
    it('formats durations and rates', () => {
        expect(formatDuration(820)).toBe('820 ms');
        expect(formatDuration(2500)).toBe('2.5 s');
        expect(formatDuration(48600)).toBe('49 s');
        expect(formatRate(7)).toBe('7.0 tok/s');
        expect(formatRate(80.4)).toBe('80 tok/s');
    });

    it('summarises tokens and speeds in one line', () => {
        expect(statsSummary(readAnswerStats(metrics)!)).toBe('1,200 in · 80 tok/s · 210 out · 7.0 tok/s');
        expect(statsSummary({ totalMs: 10 })).toBeNull();
    });

    it('lists details and flags cut-off or cached answers', () => {
        const rows = statsRows({ ...readAnswerStats(metrics)!, truncated: true, cached: true });
        expect(rows[0]).toEqual(['Model', 'qwen2.5:3b-instruct']);
        expect(rows).toContainEqual(['Writing speed', '7.0 tok/s']);
        expect(rows).toContainEqual(['Context window', '8,192 tokens']);
        expect(rows.filter(([label]) => label === 'Note')).toHaveLength(2);
    });
});
