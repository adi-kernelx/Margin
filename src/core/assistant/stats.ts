// Per-answer numbers reported by the RAG service: tokens and speeds from the
// language model, plus how long retrieval and reranking took.

export interface AnswerStats {
    model?: string;
    promptTokens?: number;
    outputTokens?: number;
    /** Prompt processing speed, tokens per second. */
    promptTps?: number;
    /** Generation speed, tokens per second. */
    outputTps?: number;
    loadMs?: number;
    promptMs?: number;
    generationMs?: number;
    retrievalMs?: number;
    rerankMs?: number;
    totalMs?: number;
    sources?: number;
    contextWindow?: number;
    /** The answer hit the token cap and may be cut off. */
    truncated?: boolean;
    /** Served from the answer cache; token figures are from the first run. */
    cached?: boolean;
}

const NUMBER_FIELDS: [keyof AnswerStats, string][] = [
    ['promptTokens', 'prompt_tokens'], ['outputTokens', 'output_tokens'],
    ['promptTps', 'prompt_tps'], ['outputTps', 'output_tps'],
    ['loadMs', 'load_ms'], ['promptMs', 'prompt_ms'], ['generationMs', 'generation_ms'],
    ['retrievalMs', 'retrieval_ms'], ['rerankMs', 'rerank_ms'], ['totalMs', 'total_ms'],
    ['sources', 'sources'], ['contextWindow', 'context_window'],
];

/** Reads the service's `metrics` object; undefined when it holds nothing useful. */
export function readAnswerStats(metrics: unknown): AnswerStats | undefined {
    if (!metrics || typeof metrics !== 'object') return undefined;
    const source = metrics as Record<string, unknown>;
    const stats: AnswerStats = {};
    for (const [key, field] of NUMBER_FIELDS) {
        const value = source[field];
        if (typeof value === 'number' && Number.isFinite(value)) (stats as Record<string, number>)[key] = value;
    }
    if (typeof source.llm_model === 'string') stats.model = source.llm_model;
    if (source.truncated === true) stats.truncated = true;
    if (source.cached === true) stats.cached = true;
    return stats.outputTokens !== undefined || stats.totalMs !== undefined ? stats : undefined;
}

export function formatDuration(ms: number): string {
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

export function formatRate(tps: number): string {
    return `${tps < 10 ? tps.toFixed(1) : Math.round(tps)} tok/s`;
}

const count = (n: number) => n.toLocaleString('en-US');

/** "1,200 in · 80 tok/s · 210 out · 7.0 tok/s", or null without token counts. */
export function statsSummary(stats: AnswerStats): string | null {
    const parts: string[] = [];
    if (stats.promptTokens !== undefined) parts.push(`${count(stats.promptTokens)} in`, ...(stats.promptTps ? [formatRate(stats.promptTps)] : []));
    if (stats.outputTokens !== undefined) parts.push(`${count(stats.outputTokens)} out`, ...(stats.outputTps ? [formatRate(stats.outputTps)] : []));
    return parts.length ? parts.join(' · ') : null;
}

/** Label/value rows for the expandable details, in reading order. */
export function statsRows(stats: AnswerStats): [string, string][] {
    const rows: [string, string][] = [];
    const add = (label: string, value: string | undefined) => { if (value) rows.push([label, value]); };
    add('Model', stats.model);
    add('Input tokens', stats.promptTokens !== undefined ? count(stats.promptTokens) : undefined);
    add('Reading speed', stats.promptTps ? formatRate(stats.promptTps) : undefined);
    add('Output tokens', stats.outputTokens !== undefined ? count(stats.outputTokens) : undefined);
    add('Writing speed', stats.outputTps ? formatRate(stats.outputTps) : undefined);
    add('Retrieval', stats.retrievalMs !== undefined ? formatDuration(stats.retrievalMs) : undefined);
    add('Rerank', stats.rerankMs !== undefined ? formatDuration(stats.rerankMs) : undefined);
    add('Model load', stats.loadMs ? formatDuration(stats.loadMs) : undefined);
    add('Prompt processing', stats.promptMs !== undefined ? formatDuration(stats.promptMs) : undefined);
    add('Generation', stats.generationMs !== undefined ? formatDuration(stats.generationMs) : undefined);
    add('Total', stats.totalMs !== undefined ? formatDuration(stats.totalMs) : undefined);
    add('Sources in prompt', stats.sources !== undefined ? String(stats.sources) : undefined);
    add('Context window', stats.contextWindow !== undefined ? `${count(stats.contextWindow)} tokens` : undefined);
    if (stats.truncated) rows.push(['Note', 'Stopped at the token limit; the answer may be cut off']);
    if (stats.cached) rows.push(['Note', 'Served from cache; figures are from the first run']);
    return rows;
}
