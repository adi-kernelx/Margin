import { useLayoutEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import {
    canCommitTextEditor,
    growTextEditorToContent,
    moveTextEditor,
    resizeTextEditor,
    setTextEditorDraft,
    type TextEditorBounds,
    type TextEditorFrame,
    type TextEditorSession,
} from '@/core/text-editor/state';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { cn } from '@/lib/utils';
import { FloatingFormatToolbar } from './FloatingFormatToolbar';
import { IconButton } from './ui/IconButton';

interface TextEditorStyle {
    color: string;
    backgroundColor: string;
    fontSize: number;
    fontFamily: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
}

interface TextAnnotationEditorProps {
    session: TextEditorSession;
    bounds: TextEditorBounds;
    style: TextEditorStyle;
    onChange: (session: TextEditorSession) => void;
    onCommit: (session: TextEditorSession) => void;
    onCancel: () => void;
}

type PointerInteraction = {
    kind: 'move' | 'resize';
    pointerId: number;
    captureTarget: HTMLElement;
    startX: number;
    startY: number;
    startFrame: TextEditorFrame;
};

const SUBSCRIPT: Record<string, string> = {
    '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
    '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', x: 'ₓ', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ',
    k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ',
};

const SUPERSCRIPT: Record<string, string> = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ',
    e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ',
    s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ',
};

function replaceCharacterAtCursor(value: string, cursor: number, table: Record<string, string>) {
    if (cursor < 1) return { value, cursor };
    const replacement = table[value[cursor - 1]];
    if (!replacement) return { value, cursor };
    return {
        value: value.slice(0, cursor - 1) + replacement + value.slice(cursor),
        cursor: cursor - 1 + replacement.length,
    };
}

export function TextAnnotationEditor({
    session,
    bounds,
    style,
    onChange,
    onCommit,
    onCancel,
}: TextAnnotationEditorProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const interactionRef = useRef<PointerInteraction | null>(null);
    const { textSubscript, textSuperscript } = useDocumentStore();

    useLayoutEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, [session.annotationId, session.mode]);

    useLayoutEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        // `h-full` makes scrollHeight at least the current editor height. Measure
        // the content at zero height so an empty box does not request another
        // 18px on every layout pass and recursively update its parent.
        textarea.style.height = '0px';
        const contentHeight = textarea.scrollHeight;
        textarea.style.height = '';
        const next = growTextEditorToContent(session, contentHeight, bounds);
        if (next !== session) onChange(next);
    }, [bounds, onChange, session]);

    const beginPointerInteraction = (
        kind: PointerInteraction['kind'],
        event: React.PointerEvent<HTMLElement>,
    ) => {
        interactionRef.current = {
            kind,
            pointerId: event.pointerId,
            captureTarget: event.currentTarget,
            startX: event.clientX,
            startY: event.clientY,
            startFrame: session.frame,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
    };

    const updatePointerInteraction = (event: React.PointerEvent<HTMLElement>) => {
        const interaction = interactionRef.current;
        if (!interaction || interaction.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - interaction.startX;
        const deltaY = event.clientY - interaction.startY;
        onChange(interaction.kind === 'move'
            ? moveTextEditor(
                { ...session, frame: interaction.startFrame },
                interaction.startFrame.x + deltaX,
                interaction.startFrame.y + deltaY,
                bounds,
            )
            : resizeTextEditor(
                { ...session, frame: interaction.startFrame },
                interaction.startFrame.width + deltaX,
                interaction.startFrame.height + deltaY,
                bounds,
            ));
    };

    const endPointerInteraction = (event: React.PointerEvent<HTMLElement>) => {
        const interaction = interactionRef.current;
        if (!interaction || interaction.pointerId !== event.pointerId) return;
        interactionRef.current = null;
        if (interaction.captureTarget.hasPointerCapture(event.pointerId)) {
            interaction.captureTarget.releasePointerCapture(event.pointerId);
        }
        textareaRef.current?.focus();
    };

    const commit = () => {
        if (canCommitTextEditor(session)) onCommit(session);
    };

    return (
        <div
            className="absolute pointer-events-auto"
            data-text-editor
            style={{
                left: session.frame.x,
                top: session.frame.y,
                width: session.frame.width,
                height: session.frame.height,
                zIndex: 60,
            }}
            onPointerMove={updatePointerInteraction}
            onPointerUp={endPointerInteraction}
            onPointerCancel={endPointerInteraction}
        >
            <FloatingFormatToolbar
                placement={session.frame.y < 52 ? 'below' : 'above'}
                onMovePointerDown={(event) => beginPointerInteraction('move', event)}
            />
            <div
                className={cn(
                    // Dashed outline reads as a selectable edit region; the
                    // token surface follows the theme automatically.
                    'relative h-full overflow-hidden rounded border-2 border-dashed border-accent bg-surface-1 shadow-elev-3',
                )}
            >
                <div className="absolute right-1 top-1 z-10 flex gap-1">
                    <IconButton
                        aria-label="Commit text"
                        title="Commit text (Ctrl+Enter)"
                        size="sm"
                        disabled={!canCommitTextEditor(session)}
                        onClick={commit}
                    >
                        <Check size={14} />
                    </IconButton>
                    <IconButton
                        aria-label="Cancel text editing"
                        title="Cancel text editing (Escape)"
                        size="sm"
                        onClick={onCancel}
                    >
                        <X size={14} />
                    </IconButton>
                </div>

                <textarea
                    ref={textareaRef}
                    aria-label={session.mode === 'create' ? 'New text annotation' : 'Edit text annotation'}
                    className="h-full w-full resize-none rounded bg-transparent p-2 pr-20 outline-none"
                    style={{
                        color: style.color,
                        backgroundColor: style.backgroundColor === 'transparent'
                            ? 'transparent'
                            : style.backgroundColor,
                        fontSize: style.fontSize,
                        fontFamily: style.fontFamily,
                        fontWeight: style.bold ? 'bold' : 'normal',
                        fontStyle: style.italic ? 'italic' : 'normal',
                        textDecoration: style.underline ? 'underline' : 'none',
                    }}
                    placeholder="Type your text…"
                    value={session.draft}
                    onChange={(event) => {
                        const cursor = event.currentTarget.selectionStart ?? event.currentTarget.value.length;
                        const converted = textSubscript
                            ? replaceCharacterAtCursor(event.currentTarget.value, cursor, SUBSCRIPT)
                            : textSuperscript
                                ? replaceCharacterAtCursor(event.currentTarget.value, cursor, SUPERSCRIPT)
                                : { value: event.currentTarget.value, cursor };
                        onChange(setTextEditorDraft(session, converted.value));
                        requestAnimationFrame(() => {
                            textareaRef.current?.setSelectionRange(converted.cursor, converted.cursor);
                        });
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                            event.preventDefault();
                            commit();
                        } else if (event.key === 'Escape') {
                            event.preventDefault();
                            onCancel();
                        }
                    }}
                />

                <div
                    aria-label="Resize text box"
                    className="absolute bottom-0 right-0 h-6 w-6 cursor-se-resize touch-none"
                    role="button"
                    tabIndex={0}
                    style={{ background: 'linear-gradient(135deg, transparent 50%, var(--color-accent, #2c3fa8) 50%)' }}
                    onPointerDown={(event) => beginPointerInteraction('resize', event)}
                />
            </div>
        </div>
    );
}
