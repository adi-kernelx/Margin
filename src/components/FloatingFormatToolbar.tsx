import { Bold, Italic, Underline, Subscript, Superscript, Palette, Move } from 'lucide-react';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { cn } from '@/lib/utils';
import { useState, useRef, useEffect } from 'react';

interface FloatingFormatToolbarProps {
    onMovePointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void;
    placement?: 'above' | 'below';
}

export function FloatingFormatToolbar({
    onMovePointerDown,
    placement = 'above',
}: FloatingFormatToolbarProps) {
    const {
        textBold, setTextBold,
        textItalic, setTextItalic,
        textUnderline, setTextUnderline,
        textSubscript, setTextSubscript,
        textSuperscript, setTextSuperscript,
        textColor, setTextColor,
        textFontSize, setTextFontSize,
        textFontFamily, setTextFontFamily
    } = useDocumentStore();

    const [showColorPicker, setShowColorPicker] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Handle outside click to close color picker
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setShowColorPicker(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleSubscript = () => {
        if (!textSubscript) {
            setTextSubscript(true);
            setTextSuperscript(false); // Exclusive
        } else {
            setTextSubscript(false);
        }
    };

    const toggleSuperscript = () => {
        if (!textSuperscript) {
            setTextSuperscript(true);
            setTextSubscript(false); // Exclusive
        } else {
            setTextSuperscript(false);
        }
    };

    // Keyboard shortcuts for sub/super
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ctrl+. for Superscript, Ctrl+, for Subscript (Standard Google Docs/Word)
            if (e.ctrlKey && e.key === '.') {
                e.preventDefault();
                toggleSuperscript();
            } else if (e.ctrlKey && e.key === ',') {
                e.preventDefault();
                toggleSubscript();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [textSubscript, textSuperscript]);


    // One reusable style for every toggle button in the toolbar. Bold/Italic/etc
    // all press to accent-soft when active; hover uses the sunken well colour.
    const toggleClass = (active: boolean) => cn(
        "flex items-center justify-center rounded p-1.5 transition-colors duration-state",
        active
            ? "bg-accent-soft text-accent"
            : "text-text-soft hover:bg-sunken hover:text-text",
    );
    const divider = "mx-1 h-4 w-px bg-line";
    const fieldClass = "ml-1 rounded border border-line bg-surface-1 px-1 py-0.5 text-xs text-text";

    return (
        <div
            ref={containerRef}
            className={cn(
                // Floats above the text editor as an elevation-3 popover.
                "text-format-toolbar pointer-events-auto absolute left-0 z-popover flex items-center gap-1",
                "rounded-lg border border-line bg-surface-3 p-1 shadow-elev-3",
                placement === 'above' ? '-top-12' : 'top-full mt-2',
            )}
        >
            <button
                type="button"
                className={cn(
                    "flex cursor-move items-center justify-center rounded p-1.5 transition-colors duration-state",
                    "text-text-muted hover:text-text",
                )}
                onPointerDown={onMovePointerDown}
                aria-label="Move text box"
                title="Drag to move"
            >
                <Move size={14} />
            </button>

            <div className={divider} />

            {/* Bold */}
            <button
                onClick={() => setTextBold(!textBold)}
                className={toggleClass(textBold)}
                title="Bold (Ctrl+B)"
            >
                <Bold size={14} />
            </button>

            {/* Italic */}
            <button
                onClick={() => setTextItalic(!textItalic)}
                className={toggleClass(textItalic)}
                title="Italic (Ctrl+I)"
            >
                <Italic size={14} />
            </button>

            {/* Underline */}
            <button
                onClick={() => setTextUnderline(!textUnderline)}
                className={toggleClass(textUnderline)}
                title="Underline (Ctrl+U)"
            >
                <Underline size={14} />
            </button>

            <div className={divider} />

            {/* Subscript */}
            <button
                onClick={toggleSubscript}
                className={toggleClass(textSubscript)}
                title="Subscript (Ctrl+,)"
            >
                <Subscript size={14} />
            </button>

            {/* Superscript */}
            <button
                onClick={toggleSuperscript}
                className={toggleClass(textSuperscript)}
                title="Superscript (Ctrl+.)"
            >
                <Superscript size={14} />
            </button>

            <div className={divider} />

            {/* Color */}
            <div className="relative">
                <button
                    onClick={() => setShowColorPicker(!showColorPicker)}
                    className={cn(toggleClass(false), "gap-1")}
                    title="Text Color"
                >
                    <Palette size={14} />
                    <div className="w-3 h-3 rounded-full border border-line" style={{ backgroundColor: textColor }} />
                </button>
                {showColorPicker && (
                    <div className="absolute left-0 top-full mt-2 min-w-[150px] rounded-lg border border-line bg-surface-3 p-2 shadow-elev-3">
                        <input
                            type="color"
                            value={textColor}
                            onChange={(e) => setTextColor(e.target.value)}
                            className="w-full h-8 cursor-pointer rounded"
                        />
                    </div>
                )}
            </div>

            {/* Font Size */}
            <input
                type="number"
                value={textFontSize}
                onChange={(e) => {
                    const val = Number(e.target.value);
                    if (!isNaN(val) && val > 0) setTextFontSize(val);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className={cn(fieldClass, "w-12")}
                min={8}
                max={72}
                title="Font Size"
            />

            {/* Font Family (Simplified) */}
            <select
                value={textFontFamily}
                onChange={(e) => setTextFontFamily(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className={cn(fieldClass, "w-20")}
            >
                <option value="Arial">Arial</option>
                <option value="Times New Roman">Times</option>
                <option value="Courier New">Courier</option>
                <option value="Georgia">Georgia</option>
                <option value="system-ui, -apple-system, sans-serif">System</option>
            </select>

        </div>
    );
}
