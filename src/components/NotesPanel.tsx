import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, MapPin, X } from 'lucide-react';
import katex from 'katex';
import type { HighlightAnnotation } from '@/core/annotations/models';
import { exportNotesMarkdown, notesInDocumentOrder } from '@/core/notes/notes';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { VirtualizedList } from './ui/VirtualizedList';

interface NotesPanelProps {
    documentId: string;
    documentTitle: string;
    highlights: HighlightAnnotation[];
    focusedId: string | null;
    onClose: () => void;
    onFocus: (highlight: HighlightAnnotation) => void;
    onChange: (highlight: HighlightAnnotation) => void;
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

function NoteCard({
    highlight,
    focused,
    onFocus,
    onChange,
}: {
    highlight: HighlightAnnotation;
    focused: boolean;
    onFocus: () => void;
    onChange: (highlight: HighlightAnnotation) => void;
}) {
    const [draft, setDraft] = useState(highlight.note?.body ?? '');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (focused) textareaRef.current?.focus();
    }, [focused]);

    const save = () => {
        if (!highlight.note || draft === highlight.note.body) return;
        onChange({
            ...highlight,
            updatedAt: Date.now(),
            note: { ...highlight.note, body: draft },
        });
    };

    return (
        <article
            className={`mx-2 h-[198px] rounded-lg border p-3 ${focused ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2'}`}
            onClick={onFocus}
        >
            <div className="mb-2 flex items-center justify-between text-xs text-text-soft">
                <span className="inline-flex items-center gap-1"><MapPin size={13} />Page {highlight.pageNum}</span>
                <span>{highlight.note?.quote ? 'Text anchor' : 'Freehand anchor'}</span>
            </div>
            <blockquote className="mb-2 line-clamp-2 min-h-8 border-l-2 border-accent pl-2 text-xs text-text-soft">
                {highlight.note?.quote || 'Highlighted region'}
            </blockquote>
            <textarea
                ref={textareaRef}
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onBlur={save}
                onClick={event => event.stopPropagation()}
                placeholder="Write Markdown… Use $…$ for inline math."
                className="h-16 w-full resize-none rounded border border-line bg-surface-1 p-2 text-sm text-text outline-none focus:border-accent"
            />
            {draft && <div className="mt-1 truncate text-xs text-text-soft"><InlineMarkdown text={draft} /></div>}
        </article>
    );
}

export function NotesPanel(props: NotesPanelProps) {
    const { documentId, documentTitle, focusedId, highlights, onChange, onClose, onFocus } = props;
    const ordered = useMemo(() => notesInDocumentOrder(highlights.filter(item => item.note)), [highlights]);
    const listHeight = Math.max(260, (typeof window === 'undefined' ? 720 : window.innerHeight) - 160);

    return (
        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-line bg-surface-1 text-text shadow-elev-3" aria-label="Document notes">
            <header className="flex h-12 items-center justify-between border-b border-line px-3">
                <div><h2 className="font-semibold">Notes</h2><p className="text-xs text-text-muted">{ordered.length} highlights</p></div>
                <IconButton aria-label="Close notes" onClick={onClose}><X size={17} /></IconButton>
            </header>
            {ordered.length ? (
                <VirtualizedList
                    items={ordered}
                    rowHeight={210}
                    height={listHeight}
                    getKey={item => `${item.id}-${item.updatedAt}`}
                    label="Notes in document order"
                    renderItem={highlight => (
                        <NoteCard
                            highlight={highlight}
                            focused={highlight.id === focusedId}
                            onFocus={() => onFocus(highlight)}
                            onChange={onChange}
                        />
                    )}
                />
            ) : (
                <div className="grid flex-1 place-items-center p-6 text-center text-sm text-text-muted">
                    Highlight text or draw with the highlighter to create a linked note.
                </div>
            )}
            <footer className="mt-auto border-t border-line p-3">
                <Button
                    className="w-full"
                    leadingIcon={<Download size={15} />}
                    disabled={!ordered.length}
                    onClick={() => downloadMarkdown(
                        `${documentTitle.replace(/\.pdf$/i, '')}-notes.md`,
                        exportNotesMarkdown(documentTitle, documentId, ordered),
                    )}
                >Export Markdown</Button>
            </footer>
        </aside>
    );
}
