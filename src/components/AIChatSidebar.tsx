import { ArrowLeft, Clock, FileText, MessageSquarePlus, Send, Sparkles, Square, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { queryRag } from '@/lib/rag-service';
import { getIngestStatus } from '@/lib/ingest-service';
import { deleteConversation, listConversations, saveConversation } from '@/lib/assistant/history-db';
import { useServiceHealthStore } from '@/lib/services/health';
import { revealInDocument } from '@/lib/ui/navigate';
import {
    appendMessage,
    confidenceBand,
    formatElapsed,
    parsePageList,
    resolveRequestScope,
    type AssistantMessage,
    type AssistantMode,
    type AssistantScopeKind,
    type AssistantSource,
    type Conversation,
} from '@/core/assistant/conversation';
import type { DocumentEntry } from '@/types';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { EmptyState, ErrorState, Skeleton } from './ui/States';

interface AIChatSidebarProps {
    isOpen: boolean;
    onClose: () => void;
    documents?: DocumentEntry[];
    onFocusDocument?: (docId: string) => void;
    variant?: 'overlay' | 'embedded';
}

const MODES: { value: AssistantMode; label: string; hint: string }[] = [
    { value: 'qa', label: 'Ask', hint: 'Answer a question from the documents' },
    { value: 'summary', label: 'Summarise', hint: 'Condense the scope into key points' },
    { value: 'explain', label: 'Explain', hint: 'Walk through a concept step by step' },
    { value: 'compare', label: 'Compare', hint: 'Contrast documents or sections' },
    { value: 'extract', label: 'Extract', hint: 'Pull out definitions, theorems or data' },
];

const SCOPES: { value: AssistantScopeKind; label: string }[] = [
    { value: 'document', label: 'This document' },
    { value: 'open', label: 'All open' },
    { value: 'pages', label: 'Pages…' },
];

const PLACEHOLDER: Record<AssistantMode, string> = {
    qa: 'Ask about this document…',
    summary: 'What should the summary focus on? (optional)',
    explain: 'What should be explained?',
    compare: 'What should be compared?',
    extract: 'What should be extracted? e.g. “all definitions”',
};

type IndexState = { kind: 'loading' } | { kind: 'offline' } | { kind: 'none' } | { kind: 'indexed'; chunks: number } | { kind: 'pending' };

function newConversation(docId: string): Conversation {
    const now = Date.now();
    return { id: crypto.randomUUID(), docId, title: 'New conversation', messages: [], createdAt: now, updatedAt: now };
}

function relativeTime(timestamp: number): string {
    const minutes = Math.round((Date.now() - timestamp) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return new Date(timestamp).toLocaleDateString();
}

function ConfidenceMeter({ value }: { value: number }) {
    const band = confidenceBand(value);
    const filled = band === 'high' ? 3 : band === 'medium' ? 2 : 1;
    const label = band === 'high' ? 'High confidence' : band === 'medium' ? 'Medium confidence' : 'Low confidence';
    return (
        <span className="inline-flex items-center gap-1.5 text-xs text-text-muted" title={`${Math.round(value * 100)}%`}>
            <span className="flex items-end gap-0.5" aria-hidden="true">
                {[0, 1, 2].map(bar => (
                    <span key={bar} className={cn('w-1 rounded-sm', bar < filled ? (band === 'low' ? 'bg-warning' : 'bg-accent') : 'bg-line')} style={{ height: 5 + bar * 3 }} />
                ))}
            </span>
            {label}
        </span>
    );
}

function IndexBadge({ state }: { state: IndexState }) {
    const text = {
        loading: 'Checking index…',
        offline: 'Assistant service offline',
        none: 'Not indexed yet — indexing starts after text recognition finishes',
        pending: 'Open a document to check its index',
        indexed: state.kind === 'indexed' ? `Indexed for AI · ${state.chunks} passages` : '',
    }[state.kind];
    const tone = state.kind === 'indexed' ? 'text-success' : state.kind === 'offline' ? 'text-danger' : 'text-text-muted';
    return (
        <div className={cn('flex items-center gap-1.5 text-xs', tone)} role="status">
            <span className={cn('size-1.5 shrink-0 rounded-full', state.kind === 'indexed' ? 'bg-success' : state.kind === 'offline' ? 'bg-danger' : 'bg-line')} aria-hidden="true" />
            <span className="truncate">{text}</span>
        </div>
    );
}

export function AIChatSidebar({ isOpen, onClose, documents = [], onFocusDocument, variant = 'embedded' }: AIChatSidebarProps) {
    const focusedDocId = useAppStore(state => state.focusedDocId);
    const ragHealth = useServiceHealthStore(state => state.byKey.rag);
    const focusedDoc = documents.find(doc => doc.id === focusedDocId);
    // History is keyed by the persistent id so it survives reopening the file.
    const historyKey = focusedDoc?.stableId ?? '';

    const [view, setView] = useState<'chat' | 'history'>('chat');
    const [history, setHistory] = useState<Conversation[] | null>(null);
    const [conversation, setConversation] = useState<Conversation>(() => newConversation(historyKey));
    const [mode, setMode] = useState<AssistantMode>('qa');
    const [scopeKind, setScopeKind] = useState<AssistantScopeKind>('document');
    const [pageInput, setPageInput] = useState('');
    const [input, setInput] = useState('');
    const [pending, setPending] = useState<{ startedAt: number } | null>(null);
    const [now, setNow] = useState(Date.now());
    const [indexState, setIndexState] = useState<IndexState>({ kind: 'pending' });
    const abortRef = useRef<AbortController | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Switching documents switches to that document's most recent conversation.
    useEffect(() => {
        let cancelled = false;
        setHistory(null);
        void listConversations(historyKey).then(list => {
            if (cancelled) return;
            setHistory(list);
            setConversation(list[0] ?? newConversation(historyKey));
        }).catch(() => !cancelled && setHistory([]));
        return () => { cancelled = true; };
    }, [historyKey]);

    useEffect(() => {
        const fingerprint = focusedDoc?.pdfFingerprint;
        if (!isOpen || !fingerprint) {
            setIndexState({ kind: 'pending' });
            return;
        }
        if (ragHealth === 'offline') {
            setIndexState({ kind: 'offline' });
            return;
        }
        const controller = new AbortController();
        setIndexState({ kind: 'loading' });
        void getIngestStatus(fingerprint, controller.signal).then(status => {
            if (controller.signal.aborted) return;
            if (!status) setIndexState({ kind: 'offline' });
            else setIndexState(status.ingested ? { kind: 'indexed', chunks: status.chunkCount } : { kind: 'none' });
        });
        return () => controller.abort();
    }, [isOpen, focusedDoc?.pdfFingerprint, ragHealth]);

    // Elapsed-time ticker while waiting; stands in for streaming until the
    // backend exposes a token stream (register M1).
    useEffect(() => {
        if (!pending) return;
        const timer = window.setInterval(() => setNow(Date.now()), 250);
        return () => window.clearInterval(timer);
    }, [pending]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [conversation.messages.length, pending]);

    useEffect(() => {
        if (isOpen && view === 'chat') requestAnimationFrame(() => inputRef.current?.focus());
    }, [isOpen, view]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const persist = useCallback((next: Conversation) => {
        setConversation(next);
        if (!next.messages.length) return;
        void saveConversation(next).then(() => listConversations(next.docId)).then(setHistory).catch(() => undefined);
    }, []);

    const pages = useMemo(() => parsePageList(pageInput), [pageInput]);
    const canSend = !pending && ragHealth !== 'offline' && (input.trim().length > 0 || mode === 'summary');

    const send = async () => {
        if (!canSend) return;
        const question = input.trim() || 'Summarise the key points.';
        const userMessage: AssistantMessage = { id: crypto.randomUUID(), role: 'user', text: question, createdAt: Date.now(), mode };
        let working = appendMessage(conversation, userMessage);
        persist(working);
        setInput('');

        const controller = new AbortController();
        abortRef.current = controller;
        const startedAt = Date.now();
        setPending({ startedAt });
        setNow(startedAt);

        let reply: AssistantMessage;
        try {
            const response = await queryRag({
                question,
                mode,
                sessionId: conversation.id,
                scope: resolveRequestScope({ kind: scopeKind, focusedDocId, openDocIds: documents.map(doc => doc.id), pages }),
            }, controller.signal);
            reply = {
                id: crypto.randomUUID(), role: 'assistant', text: response.answer, createdAt: Date.now(), mode,
                confidence: response.confidence, sources: response.sources, elapsedMs: Date.now() - startedAt, status: 'ok',
            };
        } catch (error) {
            const stopped = controller.signal.aborted;
            reply = {
                id: crypto.randomUUID(), role: 'assistant', createdAt: Date.now(), mode, elapsedMs: Date.now() - startedAt,
                status: stopped ? 'stopped' : 'error',
                text: stopped ? 'Stopped.' : 'The assistant could not answer. Check that the local assistant service is running on port 9101.',
            };
            if (!stopped) console.error('[Assistant] query failed:', error);
        } finally {
            abortRef.current = null;
            setPending(null);
        }
        working = appendMessage(working, reply);
        persist(working);
    };

    const openSource = (source: AssistantSource) => {
        if (!onFocusDocument) return;
        revealInDocument({ docId: source.docId, page: source.page, pdfFingerprint: source.docId }, documents, onFocusDocument);
    };

    const startNew = () => {
        abortRef.current?.abort();
        setConversation(newConversation(historyKey));
        setView('chat');
    };

    const removeConversation = async (id: string) => {
        await deleteConversation(id);
        const list = await listConversations(historyKey);
        setHistory(list);
        if (conversation.id === id) setConversation(list[0] ?? newConversation(historyKey));
    };

    const isOverlay = variant === 'overlay';
    if (!isOpen) return null;

    return (
        <>
            {isOverlay && <div className="fixed inset-0 z-panel bg-black/20 backdrop-blur-sm" onClick={onClose} />}
            <aside
                aria-label="Assistant"
                className={cn(
                    'flex h-full w-[400px] max-w-full shrink-0 flex-col overflow-hidden border-l border-line bg-surface-1 text-text shadow-elev-2 animate-[panel-in_var(--dur-surface)_var(--ease)]',
                    isOverlay && 'fixed right-0 top-0 z-panel',
                )}
            >
                <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 shadow-[var(--edge-highlight)]">
                    <div className="flex min-w-0 items-center gap-2">
                        {view === 'history'
                            ? <IconButton size="sm" aria-label="Back to conversation" onClick={() => setView('chat')}><ArrowLeft size={16} /></IconButton>
                            : <span className="grid size-7 place-items-center rounded-lg bg-accent-soft text-accent"><Sparkles size={15} /></span>}
                        <div className="min-w-0">
                            <h2 className="text-sm font-semibold leading-tight">{view === 'history' ? 'Conversations' : 'Assistant'}</h2>
                            <p className="truncate text-xs text-text-muted">{focusedDoc?.name ?? 'No document focused'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <IconButton size="sm" aria-label="Conversation history" title="History" pressed={view === 'history'} onClick={() => setView(view === 'history' ? 'chat' : 'history')}><Clock size={15} /></IconButton>
                        <IconButton size="sm" aria-label="New conversation" title="New conversation" onClick={startNew}><MessageSquarePlus size={15} /></IconButton>
                        <IconButton size="sm" aria-label="Close assistant" onClick={onClose}><X size={16} /></IconButton>
                    </div>
                </header>

                {view === 'history' ? (
                    <div className="flex-1 overflow-y-auto p-3">
                        {history === null && <div className="space-y-3">{[0, 1, 2].map(row => <Skeleton key={row} lines={2} />)}</div>}
                        {history?.length === 0 && <EmptyState compact title="No conversations yet" description="Questions you ask about this document are kept here, on this machine only." />}
                        <ul className="space-y-2">
                            {history?.map(item => (
                                <li key={item.id}>
                                    <div className={cn('group flex items-start gap-2 rounded-lg border p-3 transition-all duration-state hover:-translate-y-px hover:shadow-elev-2', item.id === conversation.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2 shadow-elev-1')}>
                                        <button className="min-w-0 flex-1 text-left" onClick={() => { setConversation(item); setView('chat'); }}>
                                            <div className="truncate text-sm font-medium">{item.title}</div>
                                            <div className="mt-0.5 text-xs text-text-muted">{item.messages.length} messages · {relativeTime(item.updatedAt)}</div>
                                        </button>
                                        <IconButton size="sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Delete ${item.title}`} onClick={() => void removeConversation(item.id)}><Trash2 size={13} /></IconButton>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    <>
                        <div className="shrink-0 space-y-2 border-b border-line-soft bg-surface-1 px-3 py-2">
                            <div role="radiogroup" aria-label="Mode" className="flex gap-1 overflow-x-auto rounded-lg bg-sunken p-1">
                                {MODES.map(option => (
                                    <button
                                        key={option.value}
                                        role="radio"
                                        aria-checked={mode === option.value}
                                        title={option.hint}
                                        onClick={() => setMode(option.value)}
                                        className={cn('h-7 flex-1 shrink-0 rounded px-2 text-xs font-medium transition-colors duration-state', mode === option.value ? 'bg-surface-2 text-accent shadow-elev-1' : 'text-text-soft hover:text-text')}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="sr-only" htmlFor="assistant-scope">Scope</label>
                                <select
                                    id="assistant-scope"
                                    value={scopeKind}
                                    onChange={event => setScopeKind(event.target.value as AssistantScopeKind)}
                                    className="h-7 rounded border border-line bg-surface-2 px-2 text-xs text-text-soft outline-none focus:border-accent"
                                >
                                    {SCOPES.map(scope => <option key={scope.value} value={scope.value} disabled={scope.value !== 'open' && !focusedDoc}>{scope.label}</option>)}
                                </select>
                                {scopeKind === 'pages' && (
                                    <input
                                        value={pageInput}
                                        onChange={event => setPageInput(event.target.value)}
                                        placeholder="e.g. 1-3, 7"
                                        aria-label="Pages"
                                        className="h-7 w-28 rounded border border-line bg-sunken px-2 text-xs text-text outline-none focus:border-accent"
                                    />
                                )}
                                <div className="min-w-0 flex-1"><IndexBadge state={indexState} /></div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto px-3 py-4" aria-live="polite">
                            {ragHealth === 'offline' && !conversation.messages.length ? (
                                <ErrorState
                                    title="Assistant is offline"
                                    description="Start the local assistant service (docker compose in local-llm/) to ask questions. Reading and annotating keep working without it."
                                />
                            ) : !conversation.messages.length && !pending ? (
                                <EmptyState
                                    title={MODES.find(option => option.value === mode)!.hint}
                                    description="Answers cite the pages they came from. Click a page chip to jump there."
                                />
                            ) : (
                                <ol className="space-y-4">
                                    {conversation.messages.map(message => (
                                        <li key={message.id} className={cn('flex flex-col gap-1.5', message.role === 'user' ? 'items-end' : 'items-start')}>
                                            {message.role === 'user' ? (
                                                <div className="max-w-[85%] rounded-xl rounded-br-sm bg-accent px-3 py-2 text-sm leading-relaxed text-text-onaccent shadow-elev-1">{message.text}</div>
                                            ) : (
                                                <div className={cn(
                                                    'w-full rounded-xl rounded-bl-sm border px-3 py-2.5 text-sm leading-relaxed shadow-elev-1',
                                                    message.status === 'error' ? 'border-danger bg-danger-soft text-danger'
                                                        : message.status === 'stopped' ? 'border-line bg-sunken text-text-muted'
                                                            : 'border-line bg-surface-2 text-text',
                                                )}>
                                                    <p className="whitespace-pre-wrap">{message.text}</p>
                                                    {message.status === 'ok' && (
                                                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2">
                                                            {message.confidence !== undefined && <ConfidenceMeter value={message.confidence} />}
                                                            {message.elapsedMs !== undefined && <span className="text-xs text-text-muted">{formatElapsed(message.elapsedMs)}</span>}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {message.sources && message.sources.length > 0 && (
                                                <div className="flex flex-wrap gap-1.5" aria-label="Sources">
                                                    {message.sources.map((source, index) => (
                                                        <button
                                                            key={`${source.docId}-${source.page}-${index}`}
                                                            onClick={() => openSource(source)}
                                                            title={source.text}
                                                            className="depth-pressable inline-flex h-6 items-center gap-1 border border-line px-2 text-xs text-text-soft"
                                                        >
                                                            <FileText size={11} className="text-accent" />p. {source.page}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                    {pending && (
                                        <li className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5 shadow-elev-1">
                                            <span className="flex gap-1" aria-hidden="true">
                                                {[0, 1, 2].map(dot => <span key={dot} className="size-1.5 animate-pulse rounded-full bg-accent" style={{ animationDelay: `${dot * 160}ms` }} />)}
                                            </span>
                                            <span className="text-sm text-text-soft">Thinking · {formatElapsed(now - pending.startedAt)}</span>
                                        </li>
                                    )}
                                </ol>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        <div className="shrink-0 border-t border-line bg-surface-2 p-3">
                            <div className="flex items-end gap-2 rounded-xl border border-line bg-sunken p-2 shadow-[var(--edge-press)] focus-within:border-accent">
                                <textarea
                                    ref={inputRef}
                                    rows={2}
                                    value={input}
                                    onChange={event => setInput(event.target.value)}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter' && !event.shiftKey) {
                                            event.preventDefault();
                                            void send();
                                        }
                                    }}
                                    placeholder={PLACEHOLDER[mode]}
                                    aria-label="Message"
                                    className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-1 text-sm text-text outline-none placeholder:text-text-muted"
                                />
                                {pending ? (
                                    <Button size="sm" variant="danger" leadingIcon={<Square size={12} />} onClick={() => abortRef.current?.abort()}>Stop</Button>
                                ) : (
                                    <IconButton aria-label="Send" disabled={!canSend} onClick={() => void send()} className={cn(canSend && 'border-accent bg-accent text-text-onaccent hover:bg-accent-hover hover:text-text-onaccent')}>
                                        <Send size={15} />
                                    </IconButton>
                                )}
                            </div>
                            <p className="mt-1.5 text-center text-xs text-text-muted">Enter to send · Shift+Enter for a new line · stored only on this machine</p>
                        </div>
                    </>
                )}
            </aside>
        </>
    );
}
