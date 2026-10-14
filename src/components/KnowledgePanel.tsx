import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BadgeCheck, Download, Lightbulb, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import {
    carryVerifications, filterConcepts, groupConcepts, isVerified, verifyConcept,
    type ConceptRecord, type KnowledgeBundle,
} from '@/core/knowledge/okf';
import { downloadBlob } from '@/lib/annotations/export';
import { loadBundle, saveBundle } from '@/lib/knowledge/knowledge-db';
import {
    buildBundle, DOCUMENT_CATEGORIES, KnowledgeServiceError, LOCAL_ACTOR, type DocumentCategory,
} from '@/lib/knowledge/knowledge-service';
import { cn } from '@/lib/utils';
import { Button } from './ui/Button';
import { EmptyState, ErrorState, Skeleton } from './ui/States';

/** The source the bundle is built from: the file as imported, before page edits. */
const KNOWLEDGE_SOURCE = 'original';

interface KnowledgePanelProps {
    documentId: string;
    fileName: string;
    loadSource: (sourceId: string) => Promise<Uint8Array | null | undefined>;
    /** Jumps to a one-based page of the original PDF, at the region's vertical position. */
    onNavigate: (page: number, bbox: ConceptRecord['bbox']) => void;
}

type PanelState =
    | { kind: 'loading' }
    | { kind: 'empty' }
    | { kind: 'building' }
    | { kind: 'error'; message: string; unreachable: boolean }
    | { kind: 'ready'; bundle: KnowledgeBundle };

async function exportBundle(bundle: KnowledgeBundle) {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const [path, content] of Object.entries(bundle.files)) zip.file(path, content);
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `${bundle.fileName.replace(/\.pdf$/i, '')}-knowledge.zip`);
}

function ConceptRow({ concept, titleOf, onOpen, onOpenPath, onVerify }: {
    concept: ConceptRecord;
    titleOf: (path: string) => string | undefined;
    onOpen: () => void;
    onOpenPath: (path: string) => void;
    onVerify: () => void;
}) {
    const verified = isVerified(concept);
    const uses = concept.uses.filter(path => titleOf(path));
    return (
        <li className="group rounded-lg border border-line-soft bg-surface-2 p-2.5 shadow-elev-1 transition-colors duration-state hover:border-line">
            <div className="flex items-start gap-2">
                <button className="min-w-0 flex-1 text-left" onClick={onOpen} title={`Go to page ${concept.page}`}>
                    <span className="block truncate text-sm font-semibold text-text">{concept.title}</span>
                    <span className="mt-0.5 block text-xs text-text-muted">
                        {concept.type} · p. {concept.page}
                        {concept.proofPages.length > 0 && ` · proof p. ${concept.proofPages.join(', ')}`}
                        {concept.method === 'detector' && ' · found in prose'}
                    </span>
                </button>
                {verified ? (
                    <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded px-1.5 text-xs font-medium text-success" title={`Verified ${new Date(concept.verified!.at(-1)!.at).toLocaleString()}`}>
                        <BadgeCheck size={14} />Verified
                    </span>
                ) : (
                    <Button size="sm" variant="ghost" className="shrink-0" leadingIcon={<ShieldCheck size={13} />} onClick={onVerify} title="Mark this concept as checked by you">
                        Verify
                    </Button>
                )}
            </div>
            <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-text-soft">{concept.description}</p>
            {uses.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1" aria-label="Uses">
                    {uses.map(path => (
                        <button key={path} onClick={() => onOpenPath(path)} className="max-w-[160px] truncate rounded border border-line bg-surface-1 px-1.5 py-0.5 text-[11px] text-text-soft hover:border-accent hover:text-text">
                            {titleOf(path)}
                        </button>
                    ))}
                </div>
            )}
        </li>
    );
}

/**
 * Definitions, notation, results and algorithms extracted from the PDF as an
 * OKF bundle by the local RAG service. Everything starts as a draft; Verify
 * records the reader's check in the concept file and the bundle log.
 */
export function KnowledgePanel({ documentId, fileName, loadSource, onNavigate }: KnowledgePanelProps) {
    const [state, setState] = useState<PanelState>({ kind: 'loading' });
    const [category, setCategory] = useState<DocumentCategory>('paper');
    const [query, setQuery] = useState('');
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        let cancelled = false;
        setState({ kind: 'loading' });
        void loadBundle(documentId)
            .then(bundle => { if (!cancelled) setState(bundle ? { kind: 'ready', bundle } : { kind: 'empty' }); })
            .catch(() => { if (!cancelled) setState({ kind: 'empty' }); });
        return () => { cancelled = true; abortRef.current?.abort(); };
    }, [documentId]);

    const build = useCallback(async () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setState({ kind: 'building' });
        try {
            const bytes = await loadSource(KNOWLEDGE_SOURCE);
            if (!bytes) throw new KnowledgeServiceError('The original PDF is not stored for this document.');
            const built = await buildBundle(documentId, bytes, fileName, category, controller.signal);
            const previous = await loadBundle(documentId);
            const bundle = previous ? carryVerifications(previous, built) : built;
            await saveBundle(bundle);
            if (!controller.signal.aborted) setState({ kind: 'ready', bundle });
        } catch (error) {
            if (controller.signal.aborted) return;
            const unreachable = error instanceof KnowledgeServiceError && error.unreachable;
            setState({ kind: 'error', message: (error as Error).message, unreachable });
        }
    }, [category, documentId, fileName, loadSource]);

    const cancel = () => {
        abortRef.current?.abort();
        void loadBundle(documentId).then(bundle => setState(bundle ? { kind: 'ready', bundle } : { kind: 'empty' }));
    };

    const bundle = state.kind === 'ready' ? state.bundle : null;
    const byPath = useMemo(() => new Map(bundle?.concepts.map(concept => [concept.path, concept]) ?? []), [bundle]);
    const groups = useMemo(() => groupConcepts(filterConcepts(bundle?.concepts ?? [], query)), [bundle, query]);
    const verifiedCount = bundle?.concepts.filter(isVerified).length ?? 0;

    const verify = async (path: string) => {
        if (!bundle) return;
        const next = verifyConcept(bundle, path, { by: LOCAL_ACTOR, at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
        setState({ kind: 'ready', bundle: next });
        await saveBundle(next);
    };

    const openPath = (path: string) => {
        const target = byPath.get(path);
        if (target) onNavigate(target.page, target.bbox);
    };

    const categoryPicker = (
        <label className="flex items-center gap-2 text-xs text-text-soft">
            Document kind
            <select
                value={category}
                onChange={event => setCategory(event.target.value as DocumentCategory)}
                className="rounded border border-line bg-surface-1 px-2 py-1 text-xs text-text"
            >
                {DOCUMENT_CATEGORIES.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
        </label>
    );

    if (state.kind === 'loading') {
        return <div className="space-y-3 p-4" aria-busy="true">{[0, 1, 2].map(row => <Skeleton key={row} lines={2} />)}</div>;
    }

    if (state.kind === 'building') {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" aria-busy="true">
                <RefreshCw size={20} className="animate-spin text-accent" />
                <p className="text-sm font-medium text-text">Reading definitions and results…</p>
                <p className="max-w-xs text-xs text-text-muted">A paper takes a few seconds; a textbook can take a few minutes. You can keep reading.</p>
                <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
            </div>
        );
    }

    if (state.kind === 'empty' || state.kind === 'error') {
        return (
            <div className="flex flex-1 flex-col">
                {state.kind === 'error' ? (
                    <ErrorState
                        title={state.unreachable ? 'Knowledge service not running' : 'Could not build knowledge'}
                        description={state.unreachable
                            ? 'Start the local RAG service (port 9101) and try again. Nothing leaves this computer.'
                            : state.message}
                        onRetry={() => void build()}
                    />
                ) : (
                    <EmptyState
                        compact
                        art={<Lightbulb size={28} className="text-accent" />}
                        title="No knowledge yet"
                        description="Find the definitions, notation, theorems and algorithms in this PDF, each linked to its page. It runs on the local service; nothing is uploaded."
                        action={<Button size="sm" variant="primary" onClick={() => void build()}>Build knowledge</Button>}
                    />
                )}
                <div className="flex justify-center pb-4">{categoryPicker}</div>
            </div>
        );
    }

    const shown = groups.reduce((total, group) => total + group.concepts.length, 0);
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 space-y-2 border-b border-line-soft p-3">
                <div className="flex items-center gap-2 rounded border border-line bg-sunken px-2 shadow-[var(--edge-press)] focus-within:border-accent">
                    <Search size={13} className="shrink-0 text-text-muted" />
                    <input
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder="Filter concepts"
                        aria-label="Filter concepts"
                        className="h-8 min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
                    />
                </div>
                <p className="text-xs text-text-muted">
                    {state.bundle.concepts.length} concepts · {verifiedCount} verified · drafts until you verify them
                </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {state.bundle.concepts.length === 0 && (
                    <EmptyState compact title="Nothing found" description="This PDF has no recognisable definitions or results. Try another document kind and rebuild." />
                )}
                {state.bundle.concepts.length > 0 && shown === 0 && <p className="p-2 text-sm text-text-muted">No concept matches “{query}”.</p>}
                {groups.map(group => (
                    <section key={group.group} className="mb-4" aria-label={group.group}>
                        <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                            {group.group} <span className="font-normal">({group.concepts.length})</span>
                        </h3>
                        <ul className="space-y-2">
                            {group.concepts.map(concept => (
                                <ConceptRow
                                    key={concept.path}
                                    concept={concept}
                                    titleOf={path => byPath.get(path)?.title}
                                    onOpen={() => onNavigate(concept.page, concept.bbox)}
                                    onOpenPath={openPath}
                                    onVerify={() => void verify(concept.path)}
                                />
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
            <footer className={cn('flex shrink-0 flex-wrap items-center gap-2 border-t border-line p-3')}>
                <Button size="sm" className="flex-1" leadingIcon={<Download size={14} />} onClick={() => void exportBundle(state.bundle)}>
                    Export bundle
                </Button>
                <Button size="sm" variant="ghost" leadingIcon={<RefreshCw size={13} />} onClick={() => void build()} title="Rebuild keeps verifications of concepts whose title is unchanged">
                    Rebuild
                </Button>
                {categoryPicker}
            </footer>
        </div>
    );
}
