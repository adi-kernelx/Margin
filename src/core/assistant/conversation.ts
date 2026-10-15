// Pure model for assistant conversations. Persistence (IndexedDB) and the
// network call live in the shell; this module owns the shapes, titles,
// confidence bands and the request-scope decision.

export type AssistantMode = 'qa' | 'summary' | 'compare' | 'explain' | 'extract';
export type AssistantScopeKind = 'document' | 'open' | 'pages';

export interface SourceRegion {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

export interface AssistantSource {
    docId: string;
    page: number;
    text: string;
    score: number;
    /** A passage of the PDF, or a concept from its knowledge bundle. Older messages have neither. */
    kind?: 'passage' | 'concept';
    pdfFingerprint?: string | null;
    /** Passages send `[x0, y0, x1, y1]`, concepts `{x0, y0, x1, y1}`; page-normalised either way. */
    bbox?: SourceRegion | number[] | null;
    title?: string | null;
    type?: string | null;
    verified?: boolean;
}

/** The chip text: the page for a passage, the concept's type and title for a concept. */
export function sourceLabel(source: AssistantSource): string {
    if (source.kind !== 'concept' || !source.title) return `p. ${source.page}`;
    return `${source.type ?? 'Concept'}: ${source.title} · p. ${source.page}`;
}

/** Concepts point at their defining region; passages keep page-level navigation (their box spans the chunk). */
export function sourceRegion(source: AssistantSource): SourceRegion | undefined {
    if (source.kind !== 'concept' || !source.bbox) return undefined;
    const box = Array.isArray(source.bbox)
        ? { x0: source.bbox[0], y0: source.bbox[1], x1: source.bbox[2], y1: source.bbox[3] }
        : source.bbox;
    return [box.x0, box.y0, box.x1, box.y1].every(value => Number.isFinite(value)) ? box : undefined;
}

export interface AssistantMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    createdAt: number;
    mode?: AssistantMode;
    confidence?: number;
    sources?: AssistantSource[];
    elapsedMs?: number;
    status?: 'ok' | 'error' | 'stopped';
}

export interface Conversation {
    id: string;
    /** The document the conversation was started from, or '' for workspace-wide. */
    docId: string;
    title: string;
    messages: AssistantMessage[];
    createdAt: number;
    updatedAt: number;
}

const TITLE_LIMIT = 60;

export function conversationTitle(messages: readonly AssistantMessage[]): string {
    const first = messages.find(message => message.role === 'user')?.text.replace(/\s+/g, ' ').trim();
    if (!first) return 'New conversation';
    return first.length > TITLE_LIMIT ? `${first.slice(0, TITLE_LIMIT - 1).trimEnd()}…` : first;
}

export function appendMessage(conversation: Conversation, message: AssistantMessage): Conversation {
    const messages = [...conversation.messages, message];
    return { ...conversation, messages, title: conversationTitle(messages), updatedAt: message.createdAt };
}

export type ConfidenceBand = 'high' | 'medium' | 'low';

export function confidenceBand(confidence: number): ConfidenceBand {
    if (confidence >= 0.7) return 'high';
    if (confidence >= 0.4) return 'medium';
    return 'low';
}

export interface ScopeInput {
    kind: AssistantScopeKind;
    focusedDocId: string | null;
    openDocIds: readonly string[];
    pages: readonly number[];
}

export interface RequestScope {
    docIds?: string[];
    pages?: number[];
}

/** Resolves the UI scope choice into the `/query` request scope. */
export function resolveRequestScope({ kind, focusedDocId, openDocIds, pages }: ScopeInput): RequestScope | undefined {
    if (kind === 'open') return openDocIds.length ? { docIds: [...openDocIds] } : undefined;
    if (!focusedDocId) return undefined;
    if (kind === 'pages' && pages.length) return { docIds: [focusedDocId], pages: [...pages] };
    return { docIds: [focusedDocId] };
}

/** Parses "1-3, 7" into sorted unique positive page numbers. Invalid parts are ignored. */
export function parsePageList(input: string): number[] {
    const pages = new Set<number>();
    for (const part of input.split(',')) {
        const range = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
        if (!range) continue;
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : start;
        if (start < 1 || end < start || end - start > 2000) continue;
        for (let page = start; page <= end; page += 1) pages.add(page);
    }
    return [...pages].sort((a, b) => a - b);
}

export function formatElapsed(milliseconds: number): string {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
