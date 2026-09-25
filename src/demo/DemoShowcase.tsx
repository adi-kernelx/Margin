import { useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { BookOpen, FileUp, Highlighter, LayoutGrid, Library, Loader2, Search } from 'lucide-react';
import { parallaxOffset } from '@/core/ui/parallax';
import { Button } from '@/components/ui/Button';
import { KeyCaps } from '@/components/CommandLayer';
import { GradientField } from './GradientField';
import sampleUrl from './assets/eigenvalues-primer.pdf?url';

const SAMPLE_NAME = 'Eigenvalues — a short primer.pdf';

// Three layers, never more: the field, the paper stack, the floating note.
const LAYERS = { field: 0.15, paper: 0.55, note: 1 } as const;
const MAX_OFFSET = 14;

interface DemoShowcaseProps {
    onOpenSample: (file: File) => Promise<void> | void;
    onOpenOwn: () => void;
    onSkip: () => void;
}

const features = [
    { icon: <Highlighter size={16} />, title: 'Annotate, then connect', body: 'Ink, highlights, text and LaTeX. One note can gather highlights from many pages.' },
    { icon: <LayoutGrid size={16} />, title: 'Organise pages', body: 'Reorder, rotate, split and merge — every change undoable.' },
    { icon: <Search size={16} />, title: 'Find anything', body: 'Search across open documents; the outline jumps straight to a section.' },
] as const;

function allowMotion(): boolean {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches && !window.matchMedia('(pointer: coarse)').matches;
}

/** Isometric stack of pages with highlighter strokes, drawn from tokens. */
function PaperArt() {
    return (
        <div className="iso-scene relative size-64" aria-hidden="true">
            {[0, 1, 2].map(layer => (
                <div
                    key={layer}
                    className="absolute inset-6 rounded border border-line bg-white shadow-elev-2"
                    style={{ translate: `0 ${-layer * 16}px` }}
                >
                    {layer === 2 && (
                        <div className="space-y-2.5 p-5">
                            <div className="h-2 w-2/3 rounded-sm bg-ink-black/80" />
                            {[90, 75, 85, 60, 80].map((width, line) => (
                                <div key={line} className="relative h-1.5 rounded-sm bg-line" style={{ width: `${width}%` }}>
                                    {line === 1 && <div className="absolute -inset-y-1 left-[10%] w-3/5 rounded-sm bg-hl-yellow/70" />}
                                    {line === 3 && <div className="absolute -inset-y-1 left-0 w-2/5 rounded-sm bg-hl-green/70" />}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

/**
 * The demo's landing surface: what Margin is, in thirty seconds, with the
 * sample document one click away. Only exists in the demo build.
 */
export function DemoShowcase({ onOpenSample, onOpenOwn, onSkip }: DemoShowcaseProps) {
    const [pointer, setPointer] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!allowMotion()) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        setPointer({ x: event.clientX - bounds.left, y: event.clientY - bounds.top, width: bounds.width, height: bounds.height });
    };

    const layerStyle = (depth: number): CSSProperties => {
        if (!pointer) return { transition: 'translate var(--dur-surface) var(--ease)' };
        const offset = parallaxOffset({ pointerX: pointer.x, pointerY: pointer.y, width: pointer.width, height: pointer.height, depth, maxOffset: MAX_OFFSET });
        return { translate: `${offset.x}px ${offset.y}px`, transition: 'translate var(--dur-surface) var(--ease)' };
    };

    const openSample = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(sampleUrl);
            if (!response.ok) throw new Error(String(response.status));
            const blob = await response.blob();
            await onOpenSample(new File([blob], SAMPLE_NAME, { type: 'application/pdf', lastModified: Date.UTC(2026, 8, 1) }));
        } catch {
            setError('The sample could not be loaded. Try opening your own PDF instead.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-full overflow-y-auto bg-ground">
            <div className="mx-auto grid max-w-6xl items-center gap-10 py-10 pl-24 pr-6 lg:grid-cols-[1.1fr_1fr] lg:py-16">
                <section>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Local-first PDF workspace</p>
                    <h1 className="mt-3 text-2xl font-bold leading-tight text-text sm:text-[40px]">
                        Read, mark up and organise mathematical papers — entirely in your browser.
                    </h1>
                    <p className="mt-4 max-w-xl text-md leading-relaxed text-text-soft">
                        Margin is a reading desk for technical documents. No account and no upload: files, annotations and
                        notes live on this machine. This demo is the real app with the optional OCR and AI services turned off.
                    </p>

                    <div className="mt-7 flex flex-wrap items-center gap-3">
                        <Button variant="primary" leadingIcon={loading ? <Loader2 size={16} className="animate-spin" /> : <BookOpen size={16} />} disabled={loading} onClick={() => void openSample()}>
                            Open the sample paper
                        </Button>
                        <Button leadingIcon={<FileUp size={16} />} onClick={onOpenOwn}>Open your own PDF</Button>
                        <Button variant="ghost" leadingIcon={<Library size={16} />} onClick={onSkip}>Go to the library</Button>
                    </div>
                    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
                    <p className="mt-4 flex items-center gap-1.5 text-xs text-text-muted">
                        Press <KeyCaps shortcut="Mod+K" /> anywhere for every action, <KeyCaps shortcut="?" /> for shortcuts.
                    </p>

                    <ul className="mt-9 grid gap-3 sm:grid-cols-3">
                        {features.map(feature => (
                            <li key={feature.title} className="depth-raised border border-line-soft p-4">
                                <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent">{feature.icon}</span>
                                <h2 className="mt-3 text-sm font-semibold text-text">{feature.title}</h2>
                                <p className="mt-1 text-xs leading-relaxed text-text-muted">{feature.body}</p>
                            </li>
                        ))}
                    </ul>
                </section>

                <div
                    className="depth-float relative isolate grid aspect-[5/4] place-items-center overflow-hidden border border-line-soft"
                    onPointerMove={onPointerMove}
                    onPointerLeave={() => setPointer(null)}
                >
                    <div className="absolute -inset-6 -z-10" style={layerStyle(LAYERS.field)}>
                        <GradientField className="size-full" />
                    </div>
                    <div style={layerStyle(LAYERS.paper)}>
                        <PaperArt />
                    </div>
                    <div
                        className="depth-overlay absolute bottom-8 right-8 w-52 border border-line p-3"
                        style={layerStyle(LAYERS.note)}
                    >
                        <div className="flex items-center gap-2 text-xs text-text-muted">
                            <span className="h-4 w-1.5 rounded-sm bg-hl-yellow" />p. 1 · “A v = λ v”
                        </div>
                        <p className="mt-2 text-sm font-medium text-text">Eigenvectors are the lines A maps to themselves.</p>
                        <p className="mt-1 text-xs text-text-muted">Linked to 2 highlights</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
