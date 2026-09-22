import { useEffect, useRef, useState } from 'react';
import { FileDown, Loader2, Merge, Plus, RotateCcw, RotateCw, Scissors, Trash2 } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { PageRecord } from '@/core/pages/models';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { IconButton } from './ui/IconButton';

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
}

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
            const cssScale = Math.min(156 / base.width, 190 / base.height);
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
        <div ref={hostRef} className="relative grid h-48 w-full place-items-center overflow-hidden rounded-md bg-ground p-2">
            {status === 'loading' && <Loader2 size={20} className="absolute animate-spin text-text-muted" aria-label="Rendering page preview" />}
            {status === 'error' && <span className="absolute text-xs text-text-muted">Preview unavailable</span>}
            <canvas
                ref={canvasRef}
                className={`max-h-full max-w-full bg-white shadow-elev-2 transition-opacity ${status === 'ready' ? 'opacity-100' : 'opacity-0'}`}
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
}: PageOrganizerProps) {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
    const importRef = useRef<HTMLInputElement>(null);

    const orderedSelection = pages.filter(page => selected.has(page.id)).map(page => page.id);
    const onlySelectedIndex = orderedSelection.length === 1
        ? pages.findIndex(page => page.id === orderedSelection[0])
        : -1;

    const toggle = (pageId: string, additive: boolean) => {
        setSelected(current => {
            const next = additive ? new Set(current) : new Set<string>();
            if (additive && next.has(pageId)) next.delete(pageId);
            else next.add(pageId);
            return next;
        });
    };

    return (
        <Dialog open={open} title="Organize pages" onClose={onClose} className="max-w-6xl">
            <div className="mb-4 flex flex-wrap gap-2" role="toolbar" aria-label="Page operations">
                <Button size="sm" leadingIcon={<Plus size={15} />} onClick={onAddBlank}>Blank page</Button>
                <Button size="sm" leadingIcon={<Merge size={15} />} onClick={() => importRef.current?.click()}>Merge PDF</Button>
                <Button size="sm" leadingIcon={<FileDown size={15} />} disabled={!orderedSelection.length} onClick={() => onExtract(orderedSelection)}>Extract</Button>
                <Button
                    size="sm"
                    leadingIcon={<Scissors size={15} />}
                    disabled={onlySelectedIndex < 0 || onlySelectedIndex >= pages.length - 1}
                    onClick={() => onSplit(orderedSelection[0])}
                >Split after</Button>
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
                <span className="grow" />
                <IconButton aria-label="Rotate selected left" disabled={!orderedSelection.length} onClick={() => onRotate(orderedSelection, -90)}><RotateCcw size={17} /></IconButton>
                <IconButton aria-label="Rotate selected right" disabled={!orderedSelection.length} onClick={() => onRotate(orderedSelection, 90)}><RotateCw size={17} /></IconButton>
                <IconButton aria-label="Delete selected pages" disabled={!orderedSelection.length || orderedSelection.length >= pages.length} onClick={() => onDelete(orderedSelection)}><Trash2 size={17} /></IconButton>
            </div>

            <p className="mb-3 text-sm text-text-soft">Click to select; Ctrl-click selects several. Drag a page to reorder it.</p>
            <div className="grid max-h-[68vh] grid-cols-2 gap-4 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
                {pages.map((page, index) => {
                    const isSelected = selected.has(page.id);
                    return (
                        <button
                            key={page.id}
                            type="button"
                            draggable
                            onDragStart={() => setDraggedPageId(page.id)}
                            onDragEnd={() => setDraggedPageId(null)}
                            onDragOver={event => event.preventDefault()}
                            onDrop={() => {
                                if (draggedPageId && draggedPageId !== page.id) onMove(draggedPageId, index);
                                setDraggedPageId(null);
                            }}
                            onClick={event => toggle(page.id, event.ctrlKey || event.metaKey)}
                            className={`group rounded-xl border p-2 text-left shadow-elev-1 transition-[border-color,background-color,box-shadow,transform] hover:-translate-y-0.5 hover:shadow-elev-2 ${draggedPageId === page.id ? 'opacity-50' : ''} ${isSelected ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line bg-surface-2 hover:border-line-strong hover:bg-surface-3'}`}
                            aria-pressed={isSelected}
                        >
                            <PageThumbnail pdfDoc={pdfDoc} pageNum={index + 1} />
                            <div className="mt-2 flex items-center justify-between text-xs text-text-soft">
                                <span className="font-medium text-text">Page {index + 1}</span>
                                <span>{page.kind === 'blank' ? 'Blank' : `${page.rotation}°`}</span>
                            </div>
                        </button>
                    );
                })}
            </div>
        </Dialog>
    );
}
