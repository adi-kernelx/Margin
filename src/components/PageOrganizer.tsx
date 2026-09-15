import { useRef, useState } from 'react';
import { FileDown, FilePlus2, Merge, Plus, RotateCcw, RotateCw, Scissors, Trash2 } from 'lucide-react';
import type { PageRecord } from '@/core/pages/models';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { IconButton } from './ui/IconButton';

interface PageOrganizerProps {
    open: boolean;
    pages: PageRecord[];
    onClose: () => void;
    onAddBlank: () => void;
    onDelete: (pageIds: string[]) => void;
    onMove: (pageId: string, toIndex: number) => void;
    onRotate: (pageIds: string[], delta: 90 | -90) => void;
    onMerge: (file: File) => void;
    onExtract: (pageIds: string[]) => void;
    onSplit: (afterPageId: string) => void;
}

export function PageOrganizer({
    open,
    pages,
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
        <Dialog open={open} title="Organize pages" onClose={onClose} className="max-w-4xl">
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
            <div className="grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4">
                {pages.map((page, index) => {
                    const isSelected = selected.has(page.id);
                    const rotated = page.rotation === 90 || page.rotation === 270;
                    const ratio = rotated ? page.height / page.width : page.width / page.height;
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
                            className={`rounded-lg border p-2 text-left transition-colors ${isSelected ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2 hover:bg-surface-3'}`}
                            aria-pressed={isSelected}
                        >
                            <div className="grid h-32 place-items-center rounded border border-line-soft bg-white shadow-elev-1">
                                <div
                                    className="grid place-items-center border border-gray-200 bg-gray-50 text-lg font-semibold text-gray-500"
                                    style={{ width: `${Math.min(76, 96 * ratio)}px`, height: `${Math.min(108, 76 / Math.max(ratio, 0.2))}px` }}
                                >
                                    {page.kind === 'blank' ? <FilePlus2 size={24} /> : index + 1}
                                </div>
                            </div>
                            <div className="mt-2 flex items-center justify-between text-xs text-text-soft">
                                <span>Page {index + 1}</span><span>{page.rotation}°</span>
                            </div>
                        </button>
                    );
                })}
            </div>
        </Dialog>
    );
}
