import { useState, useEffect, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
// import 'katex/dist/contrib/mhchem.js'; // Try to import mhchem if available, otherwise might fail build if not present
import { X, Check, Calculator } from 'lucide-react';


// We'll try to load mhchem dynamically or assuming it's patched into katex
// If not, we'll proceed without it for now or user can install it.
// Actually, in a React env, usually: import 'katex/dist/contrib/mhchem';

interface MathModalProps {
    isOpen: boolean;
    onClose: () => void;
    onInsert: (latex: string, displayMode: boolean) => void;
    initialLatex?: string;
}

export function MathModal({ isOpen, onClose, onInsert, initialLatex = '' }: MathModalProps) {
    const [latex, setLatex] = useState(initialLatex);
    const [displayMode, setDisplayMode] = useState(true);
    const previewRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            setLatex(initialLatex);
        }
    }, [isOpen, initialLatex]);

    useEffect(() => {
        if (previewRef.current) {
            try {
                katex.render(latex || '\\text{Type a formula...}', previewRef.current, {
                    displayMode: displayMode,
                    throwOnError: false,
                    macros: {
                        "\\ce": "\\text{#1}", // Fallback for ce if mhchem not loaded
                    }
                });
            } catch (e) {
                previewRef.current.textContent = "Invalid LaTeX";
            }
        }
    }, [latex, displayMode, isOpen]);

    if (!isOpen) return null;

    const insertSymbol = (symbol: string) => {
        // Simple append for now. 
        // Ideal: insert at cursor position.
        setLatex(prev => prev + symbol);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
                    <div className="flex items-center gap-2">
                        <Calculator className="text-blue-600 dark:text-blue-400" />
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                            Insert Math Equation
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* Editor Column */}
                    <div className="w-1/2 flex flex-col border-r dark:border-gray-700 p-4 gap-4">

                        {/* Toolbar */}
                        <div className="grid grid-cols-6 gap-2">
                            <button onClick={() => insertSymbol('^{}')} className="p-2 border rounded hover:bg-gray-100 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700 text-sm">Sup</button>
                            <button onClick={() => insertSymbol('_{}')} className="p-2 border rounded hover:bg-gray-100 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700 text-sm">Sub</button>
                            <button onClick={() => insertSymbol('\\frac{}{}')} className="p-2 border rounded hover:bg-gray-100 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700 text-sm">Frac</button>
                            <button onClick={() => insertSymbol('\\sqrt{}')} className="p-2 border rounded hover:bg-gray-100 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700 text-sm">Sqrt</button>
                            <button onClick={() => insertSymbol('\\rightarrow ')} className="p-2 border rounded hover:bg-gray-100 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700 text-sm">Arrow</button>
                            <button onClick={() => insertSymbol('\\ce{}')} className="p-2 border rounded hover:bg-gray-100 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700 text-sm">Chem</button>
                        </div>

                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                LaTeX Input
                            </label>
                            <textarea
                                value={latex}
                                onChange={(e) => setLatex(e.target.value)}
                                className="w-full h-full p-4 font-mono text-sm border rounded-lg resize-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300"
                                placeholder="Type \frac{a}{b} or \ce{H2O}..."
                                autoFocus
                            />
                        </div>

                        <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={displayMode}
                                    onChange={(e) => setDisplayMode(e.target.checked)}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                Display Mode (Block)
                            </label>
                        </div>
                    </div>

                    {/* Preview Column */}
                    <div className="w-1/2 bg-gray-50 dark:bg-gray-900/50 p-6 flex flex-col">
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4 uppercase tracking-wider">
                            Live Preview
                        </h3>
                        <div className="flex-1 flex items-center justify-center overflow-auto border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-4">
                            <div
                                ref={previewRef}
                                className="text-xl text-gray-900 dark:text-white"
                            />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-gray-800">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg font-medium bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onInsert(latex, displayMode)}
                        disabled={!latex.trim()}
                        className="px-6 py-2 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Check size={20} />
                        Insert Equation
                    </button>
                </div>
            </div>
        </div>
    );
}
