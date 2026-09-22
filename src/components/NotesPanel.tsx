import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Link, MapPin, Plus, Trash2, Unlink, X } from 'lucide-react';
import katex from 'katex';
import type { DocumentNote, NoteAnchor } from '@/core/notes/models';
import { exportNotesMarkdown, notesInDocumentOrder } from '@/core/notes/notes';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { VirtualizedList } from './ui/VirtualizedList';

interface NotesPanelProps {
    documentId: string;
    documentTitle: string;
    notes: DocumentNote[];
    activeNoteId: string | null;
    focusedHighlightId: string | null;
    onClose: () => void;
    onCreate: () => void;
    onSelect: (noteId: string) => void;
    onChange: (note: DocumentNote) => void;
    onDelete: (note: DocumentNote) => void;
    onFocusAnchor: (anchor: NoteAnchor) => void;
    onAttachFocused: () => void;
    onDetachAnchor: (note: DocumentNote, highlightId: string) => void;
}

function downloadMarkdown(filename: string, markdown: string) {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

function InlineMarkdown({ text }: { text: string }) {
    const parts = text.split(/(\$[^$]+\$)/g);
    return <>{parts.map((part, index) => {
        if (part.startsWith('$') && part.endsWith('$')) {
            const html = katex.renderToString(part.slice(1, -1), { throwOnError: false, strict: 'warn' });
            return <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
        }
        return <span key={index}>{part}</span>;
    })}</>;
}

function NoteCard({ note, active, onSelect, onChange, onDelete, onFocusAnchor, onDetachAnchor }: {
    note: DocumentNote;
    active: boolean;
    onSelect: () => void;
    onChange: (note: DocumentNote) => void;
    onDelete: () => void;
    onFocusAnchor: (anchor: NoteAnchor) => void;
    onDetachAnchor: (highlightId: string) => void;
}) {
    const [draft, setDraft] = useState(note.body);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => { if (active) textareaRef.current?.focus(); }, [active]);

    const save = () => {
        if (draft === note.body) return;
        onChange({ ...note, body: draft, updatedAt: Date.now() });
    };

    return (
        <article
            className={`mx-2 h-[250px] rounded-lg border p-3 ${active ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2'}`}
            onClick={onSelect}
        >
            <div className="mb-2 flex items-center justify-between text-xs text-text-soft">
                <span>{note.anchors.length} {note.anchors.length === 1 ? 'anchor' : 'anchors'}</span>
                <IconButton aria-label="Delete note" onClick={event => { event.stopPropagation(); onDelete(); }}><Trash2 size={14} /></IconButton>
            </div>
            <div className="mb-2 flex min-h-8 gap-1 overflow-x-auto" aria-label="Note anchors">
                {note.anchors.map(anchor => (
                    <span key={anchor.id} className="inline-flex h-7 shrink-0 items-center rounded border border-line bg-surface-1 text-xs">
                        <button className="inline-flex h-full items-center gap-1 px-2" title={anchor.quote || 'Highlighted region'} onClick={event => { event.stopPropagation(); onFocusAnchor(anchor); }}>
                            <MapPin size={12} />Page {anchor.pageNum}
                        </button>
                        <button className="h-full border-l border-line px-1 text-text-muted hover:text-text" aria-label={`Detach page ${anchor.pageNum} anchor`} onClick={event => { event.stopPropagation(); onDetachAnchor(anchor.highlightId); }}>
                            <Unlink size={11} />
                        </button>
                    </span>
                ))}
                {!note.anchors.length && <span className="text-xs text-text-muted">No anchors yet</span>}
            </div>
            <textarea
                ref={textareaRef}
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onBlur={save}
                onClick={event => event.stopPropagation()}
                placeholder="Write a note… Use $…$ for inline math."
                className="h-24 w-full resize-none rounded border border-line bg-surface-1 p-2 text-sm text-text outline-none focus:border-accent"
            />
            {draft && <div className="mt-2 truncate text-xs text-text-soft"><InlineMarkdown text={draft} /></div>}
        </article>
    );
}

export function NotesPanel(props: NotesPanelProps) {
    const { activeNoteId, documentId, documentTitle, focusedHighlightId, notes, onAttachFocused, onChange, onClose, onCreate, onDelete, onDetachAnchor, onFocusAnchor, onSelect } = props;
    const ordered = useMemo(() => notesInDocumentOrder(notes), [notes]);
    const active = notes.find(note => note.id === activeNoteId);
    const focusedAlreadyAttached = Boolean(active && focusedHighlightId && active.anchors.some(anchor => anchor.highlightId === focusedHighlightId));
    const listHeight = Math.max(260, (typeof window === 'undefined' ? 720 : window.innerHeight) - 235);

    return (
        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-line bg-surface-1 text-text shadow-elev-3" aria-label="Document notes">
            <header className="border-b border-line p-3">
                <div className="flex items-center justify-between">
                    <div><h2 className="font-semibold">Notes</h2><p className="text-xs text-text-muted">{ordered.length} notes</p></div>
                    <IconButton aria-label="Close notes" onClick={onClose}><X size={17} /></IconButton>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button leadingIcon={<Plus size={14} />} onClick={onCreate}>New note</Button>
                    <Button leadingIcon={<Link size={14} />} disabled={!active || !focusedHighlightId || focusedAlreadyAttached} onClick={onAttachFocused}>Attach highlight</Button>
                </div>
                <p className="mt-2 text-xs text-text-muted">Select a note to make it active. New highlights attach to the active note.</p>
            </header>
            {ordered.length ? (
                <VirtualizedList
                    items={ordered}
                    rowHeight={262}
                    height={listHeight}
                    getKey={item => `${item.id}-${item.updatedAt}`}
                    label="Notes in document order"
                    renderItem={note => (
                        <NoteCard
                            note={note}
                            active={note.id === activeNoteId}
                            onSelect={() => onSelect(note.id)}
                            onChange={onChange}
                            onDelete={() => onDelete(note)}
                            onFocusAnchor={onFocusAnchor}
                            onDetachAnchor={highlightId => onDetachAnchor(note, highlightId)}
                        />
                    )}
                />
            ) : (
                <div className="grid flex-1 place-items-center p-6 text-center text-sm text-text-muted">Create a note, then highlight related passages. Multiple highlights can belong to the same note.</div>
            )}
            <footer className="mt-auto border-t border-line p-3">
                <Button className="w-full" leadingIcon={<Download size={15} />} disabled={!ordered.length} onClick={() => downloadMarkdown(`${documentTitle.replace(/\.pdf$/i, '')}-notes.md`, exportNotesMarkdown(documentTitle, documentId, ordered))}>Export Markdown</Button>
            </footer>
        </aside>
    );
}
