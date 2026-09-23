import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    ArrowLeft, ArrowRight, FileDown, GripHorizontal, Loader2, Merge, Plus, Redo2,
    RotateCcw, RotateCw, Scissors, Trash2, Undo2, X,
} from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { PageRecord } from '@/core/pages/models';
import { computeFlip, invertTransform } from '@/core/ui/flip';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { cn } from '@/lib/utils';

interface PageOrganizerProps {
    open: boolean;
    pages: PageRecord[];
    pdfDoc: PDFDocumentProxy | null;
    onClose: () => void;
    onAddBlank: () => void;
    onDelete: (pageIds: string[]) => void;
    onMove: (pageId: string, toIndex: number) => void;
    onRotate: (pageIds: string[], delta: 90 | -90) => void;
    onMerge: (file: File) => void;
    onExtract: (pageIds: string[]) => void;
    onSplit: (afterPageId: string) => void;
    onUndo?: () => void;
    onRedo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
}

const REDUCED_MOTION = () =>
    typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A single page thumbnail. Lazily rendered from PDF.js at the current pixel
 * density; a paper-coloured placeholder occupies the same rectangle until the
 * render completes so the grid never reflows as thumbs arrive.
 */
function PageThumbnail({ pdfDoc, pageNum }: { pdfDoc: PDFDocumentProxy | null; pageNum: number }) {
    const hostRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [visible, setVisible] = useState(false);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setVisible(true);
                observer.disconnect();
            }
        }, { rootMargin: '160px' });
        observer.observe(host);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!visible || !pdfDoc || !canvasRef.current) return;
        let cancelled = false;
        let renderTask: RenderTask | null = null;

        void pdfDoc.getPage(pageNum).then(page => {
            if (cancelled || !canvasRef.current) return;
            setStatus('loading');
            const base = page.getViewport({ scale: 1 });
            const cssScale = Math.min(156 / base.width, 200 / base.height);
            const outputScale = Math.min(window.devicePixelRatio || 1, 2);
            const viewport = page.getViewport({ scale: cssScale * outputScale });
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d', { alpha: false });
            if (!context) throw new Error('Canvas 2D is unavailable');
            canvas.width = Math.max(1, Math.round(viewport.width));
            canvas.height = Math.max(1, Math.round(viewport.height));
            canvas.style.width = `${Math.round(viewport.width / outputScale)}px`;
            canvas.style.height = `${Math.round(viewport.height / outputScale)}px`;
            renderTask = page.render({ canvas, canvasContext: context, viewport });
            return renderTask.promise;
        }).then(() => {
            if (!cancelled) setStatus('ready');
        }).catch(error => {
            if (!cancelled && error?.name !== 'RenderingCancelledException') setStatus('error');
        });

        return () => {
            cancelled = true;
            renderTask?.cancel();
        };
    }, [pdfDoc, pageNum, visible]);

    return (
        <div ref={hostRef} className="relative grid h-52 w-full place-items-center overflow-hidden rounded-md bg-sunken p-2">
            {status !== 'ready' && (
                // Paper-coloured placeholder holds the space the rendered
                // canvas will fill, preventing layout shift as thumbs arrive.
                <div className="absolute inset-2 rounded-sm bg-surface-1" aria-hidden />
            )}
            {status === 'loading' && <Loader2 size={20} className="absolute animate-spin text-text-muted" aria-label="Rendering page preview" />}
            {status === 'error' && <span className="absolute text-xs text-text-muted">Preview unavailable</span>}
            <canvas
                ref={canvasRef}
                className={cn(
                    'relative max-h-full max-w-full bg-white transition-opacity',
                    status === 'ready' ? 'opacity-100' : 'opacity-0',
                )}
                style={{ boxShadow: 'var(--page-shadow)' }}
                aria-label={`Preview of page ${pageNum}`}
            />
        </div>
    );
}

export function PageOrganizer({
    open,
    pages,
    pdfDoc,
    onClose,
    onAddBlank,
    onDelete,
    onMove,
    onRotate,
    onMerge,
    onExtract,
    onSplit,
    onUndo,
    onRedo,
    canUndo = false,
    canRedo = false,
}: PageOrganizerProps) {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
    const [focusedPageId, setFocusedPageId] = useState<string | null>(null);
    const importRef = useRef<HTMLInputElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    // Positions captured before a re-layout so we can play items back into
    // place with FLIP. The record is keyed by page ID so the animation
    // survives insertions, deletions, and rotations.
    const lastRectsRef = useRef<Map<string, DOMRect>>(new Map());

    const orderedSelection = pages.filter(page => selected.has(page.id)).map(page => page.id);
    const onlySelectedIndex = orderedSelection.length === 1
        ? pages.findIndex(page => page.id === orderedSelection[0])
        : -1;
    const canDeleteAll = orderedSelection.length > 0 && orderedSelection.length < pages.length;

    const toggle = useCallback((pageId: string, additive: boolean) => {
        setSelected(current => {
            const next = additive ? new Set(current) : new Set<string>();
            if (additive && next.has(pageId)) next.delete(pageId);
            else next.add(pageId);
            return next;
        });
        setFocusedPageId(pageId);
    }, []);

    // Non-drag reorder: Alt+Arrow moves the focused page one slot, arrows
    // alone move focus. This satisfies WCAG 2.2 dragging-alternative rule.
    useEffect(() => {
        if (!open) return;
        const handler = (event: KeyboardEvent) => {
            if (!focusedPageId) return;
            const currentIndex = pages.findIndex(page => page.id === focusedPageId);
            if (currentIndex < 0) return;
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                const delta = event.key === 'ArrowRight' ? 1 : -1;
                if (event.altKey) {
                    const target = Math.max(0, Math.min(pages.length - 1, currentIndex + delta));
                    if (target !== currentIndex) onMove(focusedPageId, target);
                } else {
                    const nextIndex = Math.max(0, Math.min(pages.length - 1, currentIndex + delta));
                    setFocusedPageId(pages[nextIndex].id);
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, focusedPageId, pages, onMove]);

    // Capture rectangles before the DOM updates, then play FLIP after paint.
    // The measurement lives in the shell; the arithmetic is in core/ui/flip.
    useLayoutEffect(() => {
        if (!open || !gridRef.current) return;
        const grid = gridRef.current;
        const items = grid.querySelectorAll<HTMLElement>('[data-page-id]');
        if (REDUCED_MOTION()) {
            lastRectsRef.current = new Map();
            for (const item of items) lastRectsRef.current.set(item.dataset.pageId!, item.getBoundingClientRect());
            return;
        }
        for (const item of items) {
            const key = item.dataset.pageId!;
            const before = lastRectsRef.current.get(key);
            const after = item.getBoundingClientRect();
            if (before) {
                const delta = computeFlip(before, after);
                if (delta.dx || delta.dy) {
                    item.animate(
                        [
                            { transform: invertTransform(delta) },
                            { transform: 'none' },
                        ],
                        { duration: 220, easing: 'cubic-bezier(.2, 0, 0, 1)' },
                    );
                }
            }
        }
        // Freshen the record after every render so the next mutation flips
        // from its new positions.
        const next = new Map<string, DOMRect>();
        for (const item of items) next.set(item.dataset.pageId!, item.getBoundingClientRect());
        lastRectsRef.current = next;
    });

    // No-op except when the organiser is open so unmounting it does not leave
    // event handlers subscribed.
    if (!open) return null;

    return (
        // The organiser sits at elevation 4 as a full-viewport overlay. It
        // deliberately covers the pane grid so the operations that follow do
        // not compete with a live pane behind them.
        <div className="fixed inset-0 z-dialog flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Organize pages">
            <div
                className="depth-dialog flex h-full w-full max-w-6xl flex-col overflow-hidden"
                onClick={event => event.stopPropagation()}
            >
                <header className="flex items-center justify-between border-b border-line-soft px-5 py-3">
                    <div>
                        <h2 className="text-lg font-semibold text-text">Organize pages</h2>
                        <p className="text-xs text-text-muted">
                            {pages.length} page{pages.length === 1 ? '' : 's'}
                            {orderedSelection.length ? ` · ${orderedSelection.length} selected` : ''}
                        </p>
                    </div>
                    <div className="flex items-center gap-1">
                        <IconButton aria-label="Undo" disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></IconButton>
                        <IconButton aria-label="Redo" disabled={!canRedo} onClick={onRedo}><Redo2 size={16} /></IconButton>
                        <IconButton aria-label="Close organiser" onClick={onClose}><X size={16} /></IconButton>
                    </div>
                </header>

                <div className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-surface-2 px-5 py-3" role="toolbar" aria-label="Page operations">
                    <Button size="sm" leadingIcon={<Plus size={15} />} onClick={onAddBlank}>Blank page</Button>
                    <Button size="sm" leadingIcon={<Merge size={15} />} onClick={() => importRef.current?.click()}>Merge PDF</Button>
                    <input
                        ref={importRef}
                        className="hidden"
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={event => {
                            const file = event.target.files?.[0];
                            if (file) onMerge(file);
                            event.target.value = '';
                        }}
                    />
                    <p className="ml-4 hidden text-xs text-text-muted sm:block">
                        Click to select, Ctrl-click for many · Drag to reorder · Alt+← / Alt+→ to move the focused page
                    </p>
                </div>

                <div
                    ref={gridRef}
                    className="flex-1 overflow-y-auto p-5"
                >
                    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
                        {pages.map((page, index) => {
                            const isSelected = selected.has(page.id);
                            const isFocused = focusedPageId === page.id;
                            const isDragging = draggedPageId === page.id;
                            return (
                                <button
                                    key={page.id}
                                    data-page-id={page.id}
                                    type="button"
                                    draggable
                                    aria-pressed={isSelected}
                                    onDragStart={event => {
                                        setDraggedPageId(page.id);
                                        event.dataTransfer.effectAllowed = 'move';
                                    }}
                                    onDragEnd={() => setDraggedPageId(null)}
                                    onDragOver={event => event.preventDefault()}
                                    onDrop={() => {
                                        if (draggedPageId && draggedPageId !== page.id) onMove(draggedPageId, index);
                                        setDraggedPageId(null);
                                    }}
                                    onClick={event => toggle(page.id, event.ctrlKey || event.metaKey)}
                                    onFocus={() => setFocusedPageId(page.id)}
                                    className={cn(
                                        'group relative rounded-xl border p-2 text-left transition-[transform,box-shadow,background-color,border-color]',
                                        'shadow-elev-1',
                                        isSelected
                                            ? 'border-accent bg-accent-soft ring-1 ring-accent'
                                            : 'border-line bg-surface-2 hover:border-line hover:bg-surface-3',
                                        // Lift on grab: the page pulls forward
                                        // and picks up a big shadow so it reads
                                        // as being off the desk in the user's
                                        // hand.
                                        isDragging && 'z-10 -translate-y-1 scale-[1.03] rotate-[1.5deg] shadow-elev-4 opacity-95',
                                        isFocused && 'ring-2 ring-accent',
                                    )}
                                >
                                    {/* Drag handle affordance in the corner. */}
                                    <span
                                        className="pointer-events-none absolute right-2 top-2 rounded bg-surface-3 p-0.5 text-text-muted opacity-0 shadow-elev-1 transition-opacity group-hover:opacity-100"
                                        aria-hidden
                                    >
                                        <GripHorizontal size={12} />
                                    </span>
                                    <PageThumbnail pdfDoc={pdfDoc} pageNum={index + 1} />
                                    <div className="mt-2 flex items-center justify-between text-xs text-text-soft">
                                        <span className="font-medium text-text">Page {index + 1}</span>
                                        <span className="font-mono text-text-muted">
                                            {page.kind === 'blank' ? 'Blank' : `${page.rotation}°`}
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Floating selection bar. Elevation 3, appears from the
                    bottom only when there is a selection to act on. */}
                {orderedSelection.length > 0 && (
                    <div className="border-t border-line-soft bg-surface-3 px-5 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm text-text-soft">
                                {orderedSelection.length} of {pages.length} selected
                            </p>
                            <div className="flex flex-wrap items-center gap-1">
                                <IconButton
                                    aria-label="Move left"
                                    disabled={onlySelectedIndex <= 0}
                                    onClick={() => onlySelectedIndex > 0 && onMove(orderedSelection[0], onlySelectedIndex - 1)}
                                    title="Move left (Alt+←)"
                                >
                                    <ArrowLeft size={16} />
                                </IconButton>
                                <IconButton
                                    aria-label="Move right"
                                    disabled={onlySelectedIndex < 0 || onlySelectedIndex >= pages.length - 1}
                                    onClick={() => onlySelectedIndex >= 0 && onMove(orderedSelection[0], onlySelectedIndex + 1)}
                                    title="Move right (Alt+→)"
                                >
                                    <ArrowRight size={16} />
                                </IconButton>
                                <IconButton aria-label="Rotate left" onClick={() => onRotate(orderedSelection, -90)}><RotateCcw size={16} /></IconButton>
                                <IconButton aria-label="Rotate right" onClick={() => onRotate(orderedSelection, 90)}><RotateCw size={16} /></IconButton>
                                <Button size="sm" leadingIcon={<FileDown size={15} />} onClick={() => onExtract(orderedSelection)}>Extract</Button>
                                <Button
                                    size="sm"
                                    leadingIcon={<Scissors size={15} />}
                                    disabled={onlySelectedIndex < 0 || onlySelectedIndex >= pages.length - 1}
                                    onClick={() => onSplit(orderedSelection[0])}
                                >Split after</Button>
                                <IconButton
                                    aria-label="Delete selected pages"
                                    disabled={!canDeleteAll}
                                    onClick={() => onDelete(orderedSelection)}
                                >
                                    <Trash2 size={16} />
                                </IconButton>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
