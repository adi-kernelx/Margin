// Build-time feature flags.
//
// `VITE_DEMO=1` produces the static demo: no OCR, no assistant, no service
// polling — nothing that needs a Python service. Each flag is a literal
// after Vite's env replacement, so Rollup folds the conditions and drops the
// gated modules from the demo bundle rather than just hiding them. OCR is
// removed by a module alias instead (vite.config.ts, src/hooks/useOcr.ts).

export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

/** The assistant panel and its commands. */
export const ASSISTANT_ENABLED = !IS_DEMO;

/** The Knowledge panel, which builds bundles through the RAG service. */
export const KNOWLEDGE_ENABLED = !IS_DEMO;

/** Health polling and the service pips / Settings section that show it. */
export const SERVICES_ENABLED = !IS_DEMO;
