import { useState, useEffect, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Calculator, Check } from 'lucide-react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { Switch } from './ui/Switch';

interface MathModalProps {
    isOpen: boolean;
    onClose: () => void;
    onInsert: (latex: string, displayMode: boolean) => void;
    initialLatex?: string;
}

const snippets = [
    { label: 'x²', title: 'Superscript', insert: '^{}' },
    { label: 'xᵢ', title: 'Subscript', insert: '_{}' },
    { label: 'a⁄b', title: 'Fraction', insert: '\\frac{}{}' },
    { label: '√', title: 'Square root', insert: '\\sqrt{}' },
    { label: 'Σ', title: 'Sum', insert: '\\sum_{i=1}^{n} ' },
    { label: '∫', title: 'Integral', insert: '\\int_{a}^{b} ' },
    { label: '→', title: 'Arrow', insert: '\\rightarrow ' },
    { label: 'H₂O', title: 'Chemistry', insert: '\\ce{}' },
] as const;

export function MathModal({ isOpen, onClose, onInsert, initialLatex = '' }: MathModalProps) {
    const [latex, setLatex] = useState(initialLatex);
    const [displayMode, setDisplayMode] = useState(true);
    const previewRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Reset the draft each time the dialog opens (state adjusted during
    // render rather than in an effect, so there is no stale first frame).
    const [openedWith, setOpenedWith] = useState<string | null>(isOpen ? initialLatex : null);
    if (isOpen && openedWith !== initialLatex) {
        setOpenedWith(initialLatex);
        setLatex(initialLatex);
    } else if (!isOpen && openedWith !== null) {
        setOpenedWith(null);
    }

    useEffect(() => {
        if (!previewRef.current) return;
        try {
            katex.render(latex || '\\text{Type a formula…}', previewRef.current, {
                displayMode,
                throwOnError: false,
                macros: { '\\ce': '\\text{#1}' }, // Fallback until mhchem is bundled.
            });
        } catch {
            previewRef.current.textContent = 'Invalid LaTeX';
        }
    }, [latex, displayMode, isOpen]);

    // Insert at the caret and place it inside the first empty brace pair,
    // so "Frac" leaves the cursor ready for the numerator.
    const insertSnippet = (snippet: string) => {
        const input = inputRef.current;
        const start = input?.selectionStart ?? latex.length;
        const end = input?.selectionEnd ?? latex.length;
        const next = latex.slice(0, start) + snippet + latex.slice(end);
        const braces = snippet.indexOf('{}');
        const caret = start + (braces === -1 ? snippet.length : braces + 1);
        setLatex(next);
        requestAnimationFrame(() => {
            input?.focus();
            input?.setSelectionRange(caret, caret);
        });
    };

    return (
        <Dialog
            open={isOpen}
            onClose={onClose}
            size="xl"
            icon={<Calculator size={16} />}
            title="Insert equation"
            description="LaTeX with a live preview"
            bodyClassName="p-0"
            footer={(
                <>
                    <Button onClick={onClose}>Cancel</Button>
                    <Button variant="primary" leadingIcon={<Check size={16} />} disabled={!latex.trim()} onClick={() => onInsert(latex, displayMode)}>
                        Insert equation
                    </Button>
                </>
            )}
        >
            <div className="grid min-h-[420px] md:grid-cols-2">
                <div className="flex flex-col gap-3 border-b border-line-soft p-4 md:border-b-0 md:border-r">
                    <div className="grid grid-cols-4 gap-2" role="toolbar" aria-label="Insert snippet">
                        {snippets.map(snippet => (
                            <button
                                key={snippet.title}
                                type="button"
                                title={snippet.title}
                                aria-label={snippet.title}
                                onClick={() => insertSnippet(snippet.insert)}
                                className="depth-pressable h-9 border border-line text-sm text-text"
                            >
                                {snippet.label}
                            </button>
                        ))}
                    </div>
                    <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-text-soft">
                        LaTeX
                        <textarea
                            ref={inputRef}
                            value={latex}
                            onChange={(e) => setLatex(e.target.value)}
                            className="min-h-40 flex-1 resize-none rounded-lg border border-line bg-sunken p-3 font-mono text-sm font-normal text-text shadow-[var(--edge-press)] outline-none focus:border-accent"
                            placeholder="\frac{a}{b} or \ce{H2O}"
                            spellCheck={false}
                            autoFocus
                        />
                    </label>
                    <Switch label="Display mode" description="Centred block equation instead of inline" checked={displayMode} onChange={setDisplayMode} />
                </div>
                <div className="flex flex-col bg-surface-2 p-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">Preview</h3>
                    <div className="grid flex-1 place-items-center overflow-auto rounded-lg border border-line bg-white p-6 text-xl text-ink-black shadow-page">
                        <div ref={previewRef} aria-live="polite" />
                    </div>
                </div>
            </div>
        </Dialog>
    );
}
