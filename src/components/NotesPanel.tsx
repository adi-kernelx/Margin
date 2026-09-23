import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, Link, MapPin, PenLine, Plus, Trash2, Unlink } from 'lucide-react';
import type { DocumentNote, NoteAnchor } from '@/core/notes/models';
import { exportNotesMarkdown, notesInDocumentOrder } from '@/core/notes/notes';
import { cn } from '@/lib/utils';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Markdown } from './ui/Markdown';
import { EmptyState } from './ui/States';
import { VirtualizedList } from './ui/VirtualizedList';

interface NotesPanelProps {
    documentId: string;
    documentTitle: string;
    notes: DocumentNote[];
    activeNoteId: string | null;
    focusedHighlightId: string | null;
    /** Colour of the highlight an anchor points at, for the chip swatch. */
    highlightColor?: (highlightId: string) => string | undefined;
    onCreate: () => void;
    onSelect: (noteId: string) => void;
    onChange: (note: DocumentNote) => void;
    onDelete: (note: DocumentNote) => void;
    onFocusAnchor: (anchor: NoteAnchor) => void;
    onAttachFocused: () => void;
    onDetachAnchor: (note: DocumentNote, highlightId: string) => void;
}

const ROW_HEIGHT = 262;

function downloadMarkdown(filename: string, markdown: string) {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

function NoteCard({ note, active, highlightColor, onSelect, onChange, onDelete, onFocusAnchor, onDetachAnchor }: {
    note: DocumentNote;
    active: boolean;
    highlightColor?: (highlightId: string) => string | undefined;
    onSelect: () => void;
    onChange: (note: DocumentNote) => void;
    onDelete: () => void;
    onFocusAnchor: (anchor: NoteAnchor) => void;
    onDetachAnchor: (highlightId: string) => void;
}) {
    const [draft, setDraft] = useState(note.body);
    // Empty notes open in the editor; written notes open rendered.
    const [editing, setEditing] = useState(!note.body);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const cardRef = useRef<HTMLElement>(null);

    useEffect(() => {
        if (!active) return;
        if (editing) textareaRef.current?.focus();
        const card = cardRef.current;
        if (card) {
            card.classList.remove('focus-pulse');
            void card.offsetWidth;
            card.classList.add('focus-pulse');
        }
    }, [active, editing]);

    const save = () => {
        if (draft === note.body) return;
        onChange({ ...note, body: draft, updatedAt: Date.now() });
    };

    return (
        <article
            ref={cardRef}
            aria-current={active || undefined}
            className={cn(
                'mx-3 flex h-[250px] flex-col rounded-lg border p-3 transition-[transform,box-shadow,border-color] duration-surface',
                active ? '-translate-y-0.5 border-accent bg-surface-2 shadow-elev-3' : 'border-line bg-surface-2 shadow-elev-1 hover:-translate-y-px hover:shadow-elev-2',
            )}
            onClick={onSelect}
        >
            <div className="mb-2 flex items-center justify-between gap-2 text-xs text-text-muted">
                <span>{note.anchors.length} {note.anchors.length === 1 ? 'highlight' : 'highlights'} · {new Date(note.updatedAt).toLocaleDateString()}</span>
                <div className="flex gap-1">
                    <IconButton
                        size="sm"
                        aria-label={editing ? 'Preview note' : 'Edit note'}
                        title={editing ? 'Preview' : 'Edit'}
                        onClick={event => { event.stopPropagation(); if (editing) save(); setEditing(!editing); }}
                    >
                        {editing ? <Eye size={13} /> : <PenLine size={13} />}
                    </IconButton>
                    <IconButton size="sm" aria-label="Delete note" onClick={event => { event.stopPropagation(); onDelete(); }}><Trash2 size={13} /></IconButton>
                </div>
            </div>
            <div className="mb-2 flex min-h-7 shrink-0 gap-1 overflow-x-auto" aria-label="Linked highlights">
                {note.anchors.map(anchor => (
                    <span key={anchor.id} className="inline-flex h-7 max-w-[180px] shrink-0 items-center overflow-hidden rounded border border-line bg-surface-1 text-xs shadow-elev-1">
                        <span className="h-full w-1.5 shrink-0" style={{ background: highlightColor?.(anchor.highlightId) ?? 'var(--hl-yellow)' }} aria-hidden="true" />
                        <button
                            className="inline-flex h-full min-w-0 items-center gap-1 px-2 text-text-soft hover:text-text"
                            title={anchor.quote || 'Highlighted region'}
                            onClick={event => { event.stopPropagation(); onFocusAnchor(anchor); }}
                        >
                            <MapPin size={11} className="shrink-0" />
                            <span className="shrink-0">p. {anchor.pageNum}</span>
                            {anchor.quote && <span className="truncate text-text-muted">“{anchor.quote}”</span>}
                        </button>
                        <button className="h-full shrink-0 border-l border-line px-1.5 text-text-muted hover:text-danger" aria-label={`Detach page ${anchor.pageNum} highlight`} onClick={event => { event.stopPropagation(); onDetachAnchor(anchor.highlightId); }}>
                            <Unlink size={11} />
                        </button>
                    </span>
                ))}
                {!note.anchors.length && <span className="self-center text-xs text-text-muted">No highlights linked yet</span>}
            </div>
            {editing ? (
                <textarea
                    ref={textareaRef}
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    onBlur={save}
                    onClick={event => event.stopPropagation()}
                    placeholder={'Write a note…\n# Heading, - lists, **bold**, $x^2$'}
                    className="min-h-0 flex-1 resize-none rounded border border-line bg-sunken p-2 text-sm text-text shadow-[var(--edge-press)] outline-none focus:border-accent"
                />
            ) : (
                <div
                    className="min-h-0 flex-1 cursor-text overflow-y-auto rounded p-1"
                    onDoubleClick={event => { event.stopPropagation(); setEditing(true); }}
                    title="Double-click to edit"
                >
                    {draft.trim() ? <Markdown source={draft} /> : <p className="text-sm text-text-muted">Empty note</p>}
                </div>
            )}
        </article>
    );
}

/** Measures the element's height so the virtual list fills whatever space the dock gives it. */
function useElementHeight<T extends HTMLElement>(fallback: number) {
    const ref = useRef<T>(null);
    const [height, setHeight] = useState(fallback);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => setHeight(Math.max(ROW_HEIGHT, entry.contentRect.height)));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return [ref, height] as const;
}

export function NotesPanel(props: NotesPanelProps) {
    const { activeNoteId, documentId, documentTitle, focusedHighlightId, highlightColor, notes, onAttachFocused, onChange, onCreate, onDelete, onDetachAnchor, onFocusAnchor, onSelect } = props;
    const ordered = useMemo(() => notesInDocumentOrder(notes), [notes]);
    const active = notes.find(note => note.id === activeNoteId);
    const focusedAlreadyAttached = Boolean(active && focusedHighlightId && active.anchors.some(anchor => anchor.highlightId === focusedHighlightId));
    const [listRef, listHeight] = useElementHeight<HTMLDivElement>(480);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-line-soft p-3">
                <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="primary" leadingIcon={<Plus size={14} />} onClick={onCreate}>New note</Button>
                    <Button size="sm" leadingIcon={<Link size={14} />} disabled={!active || !focusedHighlightId || focusedAlreadyAttached} onClick={onAttachFocused}>Link highlight</Button>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-text-muted">The active note collects new highlights. Click a page chip to jump to its passage.</p>
            </div>
            <div ref={listRef} className="min-h-0 flex-1 pt-3">
                {ordered.length ? (
                    <VirtualizedList
                        items={ordered}
                        rowHeight={ROW_HEIGHT}
                        height={listHeight}
                        getKey={item => `${item.id}-${item.updatedAt}`}
                        label="Notes in document order"
                        renderItem={note => (
                            <NoteCard
                                note={note}
                                active={note.id === activeNoteId}
                                highlightColor={highlightColor}
                                onSelect={() => onSelect(note.id)}
                                onChange={onChange}
                                onDelete={() => onDelete(note)}
                                onFocusAnchor={onFocusAnchor}
                                onDetachAnchor={highlightId => onDetachAnchor(note, highlightId)}
                            />
                        )}
                    />
                ) : (
                    <EmptyState
                        compact
                        title="No notes yet"
                        description="Create a note, then highlight related passages. One note can gather highlights from many pages."
                    />
                )}
            </div>
            <footer className="shrink-0 border-t border-line p-3">
                <Button className="w-full" size="sm" leadingIcon={<Download size={14} />} disabled={!ordered.length} onClick={() => downloadMarkdown(`${documentTitle.replace(/\.pdf$/i, '')}-notes.md`, exportNotesMarkdown(documentTitle, documentId, ordered))}>
                    Export notes as Markdown
                </Button>
            </footer>
        </div>
    );
}
