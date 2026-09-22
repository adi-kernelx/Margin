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
        isDarkMode,
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


    return (
        <div
            ref={containerRef}
            className={cn(
                "absolute left-0 flex items-center gap-1 p-1 rounded-lg shadow-lg border z-20 pointer-events-auto text-format-toolbar",
                placement === 'above' ? '-top-12' : 'top-full mt-2',
                isDarkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
            )}
        >
            {/* Drag Handle */}
            <button
                type="button"
                className={cn(
                    "p-1.5 rounded transition-colors cursor-move flex items-center justify-center",
                    isDarkMode ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-700"
                )}
                onPointerDown={onMovePointerDown}
                aria-label="Move text box"
                title="Drag to move"
            >
                <Move size={14} />
            </button>

            <div className={cn("w-px h-4 mx-1", isDarkMode ? "bg-gray-700" : "bg-gray-300")} />

            {/* Bold */}
            <button
                onClick={() => setTextBold(!textBold)}
                className={cn(
                    "p-1.5 rounded hover:bg-opacity-20 transition-colors",
                    textBold ? "bg-blue-500 text-white" : (isDarkMode ? "text-gray-300 hover:bg-white" : "text-gray-600 hover:bg-black")
                )}
                title="Bold (Ctrl+B)"
            >
                <Bold size={14} />
            </button>

            {/* Italic */}
            <button
                onClick={() => setTextItalic(!textItalic)}
                className={cn(
                    "p-1.5 rounded hover:bg-opacity-20 transition-colors",
                    textItalic ? "bg-blue-500 text-white" : (isDarkMode ? "text-gray-300 hover:bg-white" : "text-gray-600 hover:bg-black")
                )}
                title="Italic (Ctrl+I)"
            >
                <Italic size={14} />
            </button>

            {/* Underline */}
            <button
                onClick={() => setTextUnderline(!textUnderline)}
                className={cn(
                    "p-1.5 rounded hover:bg-opacity-20 transition-colors",
                    textUnderline ? "bg-blue-500 text-white" : (isDarkMode ? "text-gray-300 hover:bg-white" : "text-gray-600 hover:bg-black")
                )}
                title="Underline (Ctrl+U)"
            >
                <Underline size={14} />
            </button>

            <div className={cn("w-px h-4 mx-1", isDarkMode ? "bg-gray-700" : "bg-gray-300")} />

            {/* Subscript */}
            <button
                onClick={toggleSubscript}
                className={cn(
                    "p-1.5 rounded hover:bg-opacity-20 transition-colors",
                    textSubscript ? "bg-blue-500 text-white" : (isDarkMode ? "text-gray-300 hover:bg-white" : "text-gray-600 hover:bg-black")
                )}
                title="Subscript (Ctrl+,)"
            >
                <Subscript size={14} />
            </button>

            {/* Superscript */}
            <button
                onClick={toggleSuperscript}
                className={cn(
                    "p-1.5 rounded hover:bg-opacity-20 transition-colors",
                    textSuperscript ? "bg-blue-500 text-white" : (isDarkMode ? "text-gray-300 hover:bg-white" : "text-gray-600 hover:bg-black")
                )}
                title="Superscript (Ctrl+.)"
            >
                <Superscript size={14} />
            </button>

            <div className={cn("w-px h-4 mx-1", isDarkMode ? "bg-gray-700" : "bg-gray-300")} />

            {/* Color */}
            <div className="relative">
                <button
                    onClick={() => setShowColorPicker(!showColorPicker)}
                    className={cn(
                        "p-1.5 rounded hover:bg-opacity-20 transition-colors flex items-center gap-1",
                        isDarkMode ? "text-gray-300 hover:bg-white" : "text-gray-600 hover:bg-black"
                    )}
                    title="Text Color"
                >
                    <Palette size={14} />
                    <div className="w-3 h-3 rounded-full border border-gray-300" style={{ backgroundColor: textColor }} />
                </button>
                {showColorPicker && (
                    <div className={cn(
                        "absolute top-full left-0 mt-2 p-2 rounded-lg shadow-xl border min-w-[150px]",
                        isDarkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
                    )}>
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
                className={cn(
                    "w-12 px-1 py-0.5 text-xs rounded border ml-1",
                    isDarkMode ? "bg-gray-700 border-gray-600 text-white" : "bg-white border-gray-300 text-black"
                )}
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
                className={cn(
                    "w-20 px-1 py-0.5 text-xs rounded border ml-1",
                    isDarkMode ? "bg-gray-700 border-gray-600 text-white" : "bg-white border-gray-300 text-black"
                )}
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
