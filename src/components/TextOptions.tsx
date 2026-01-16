import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Palette, Bold, Italic, Underline } from 'lucide-react';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { cn } from '@/lib/utils';

interface TextOptionsProps {
    isOpen: boolean;
    onClose: () => void;
}

const fontFamilies = [
    { name: 'System', value: 'system-ui, -apple-system, sans-serif' },
    { name: 'Arial', value: 'Arial, sans-serif' },
    { name: 'Times New Roman', value: 'Times New Roman, serif' },
    { name: 'Courier New', value: 'Courier New, monospace' },
    { name: 'Georgia', value: 'Georgia, serif' },
    { name: 'Verdana', value: 'Verdana, sans-serif' },
];

export function TextOptions({ isOpen, onClose }: TextOptionsProps) {
    const {
        annotationMode,
        textColor,
        setTextColor,
        textBackgroundColor,
        setTextBackgroundColor,
        textFontSize,
        setTextFontSize,
        textFontFamily,
        setTextFontFamily,
        textBold,
        setTextBold,
        textItalic,
        setTextItalic,
        textUnderline,
        setTextUnderline,
        isDarkMode
    } = useDocumentStore();

    const [showTextColorPicker, setShowTextColorPicker] = useState(false);
    const [showBgColorPicker, setShowBgColorPicker] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                onClose();
                setShowTextColorPicker(false);
                setShowBgColorPicker(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen, onClose]);

    // Don't show if text tool is not active OR if not explicitly opened
    if (annotationMode !== 'text' || !isOpen) return null;

    return (
        <div
            ref={dropdownRef}
            className={cn(
                "absolute left-6 top-32 z-10 rounded-xl shadow-xl border",
                isDarkMode ? "bg-gray-800 border-gray-700" : "bg-white/95 backdrop-blur border-gray-200"
            )}
        >
            <button
                onClick={onClose}
                className={cn(
                    "w-full px-4 py-2 flex items-center justify-between gap-2 rounded-t-xl",
                    isDarkMode ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
                aria-label="Text options"
                aria-expanded={isOpen}
            >
                <span className={cn("text-sm font-medium", isDarkMode ? "text-gray-200" : "text-gray-700")}>
                    Text Options
                </span>
                <ChevronDown
                    size={16}
                    className={cn(
                        "transition-transform",
                        isOpen && "rotate-180",
                        isDarkMode ? "text-gray-400" : "text-gray-500"
                    )}
                />
            </button>

            {isOpen && (
                <div className="p-3 space-y-3 min-w-[280px] max-h-[60vh] overflow-y-auto custom-scrollbar">
                    {/* Text Color */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label
                                className={cn(
                                    "text-xs font-medium",
                                    isDarkMode ? "text-gray-300" : "text-gray-700"
                                )}
                            >
                                Text Color
                            </label>
                            <button
                                onClick={() => {
                                    setShowTextColorPicker(!showTextColorPicker);
                                    setShowBgColorPicker(false);
                                }}
                                className={cn(
                                    "p-1 rounded hover:bg-opacity-20",
                                    isDarkMode ? "hover:bg-white" : "hover:bg-gray-200"
                                )}
                                aria-label="Change text color"
                            >
                                <Palette size={16} className={isDarkMode ? "text-gray-400" : "text-gray-600"} />
                            </button>
                        </div>

                        {showTextColorPicker && (
                            <div className="space-y-2">
                                <input
                                    type="color"
                                    value={textColor}
                                    onChange={(e) => setTextColor(e.target.value)}
                                    className="w-full h-8 rounded cursor-pointer"
                                    aria-label="Text color picker"
                                />
                                <div className="flex items-center gap-2">
                                    <div
                                        className="w-8 h-8 rounded border"
                                        style={{
                                            backgroundColor: textColor,
                                            borderColor: isDarkMode ? '#4B5563' : '#D1D5DB'
                                        }}
                                    />
                                    <span className={cn("text-xs", isDarkMode ? "text-gray-400" : "text-gray-600")}>
                                        {textColor.toUpperCase()}
                                    </span>
                                </div>
                            </div>
                        )}

                        {!showTextColorPicker && (
                            <div className="flex items-center gap-2">
                                <div
                                    className="w-8 h-8 rounded border"
                                    style={{
                                        backgroundColor: textColor,
                                        borderColor: isDarkMode ? '#4B5563' : '#D1D5DB'
                                    }}
                                />
                                <span className={cn("text-xs", isDarkMode ? "text-gray-400" : "text-gray-600")}>
                                    {textColor.toUpperCase()}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Background Color */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label
                                className={cn(
                                    "text-xs font-medium",
                                    isDarkMode ? "text-gray-300" : "text-gray-700"
                                )}
                            >
                                Background Color
                            </label>
                            <button
                                onClick={() => {
                                    setShowBgColorPicker(!showBgColorPicker);
                                    setShowTextColorPicker(false);
                                }}
                                className={cn(
                                    "p-1 rounded hover:bg-opacity-20",
                                    isDarkMode ? "hover:bg-white" : "hover:bg-gray-200"
                                )}
                                aria-label="Change background color"
                            >
                                <Palette size={16} className={isDarkMode ? "text-gray-400" : "text-gray-600"} />
                            </button>
                        </div>

                        {showBgColorPicker && (
                            <div className="space-y-2">
                                <button
                                    onClick={() => setTextBackgroundColor('transparent')}
                                    className={cn(
                                        "w-full px-3 py-2 text-left rounded border-2 transition-all",
                                        textBackgroundColor === 'transparent'
                                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900'
                                            : isDarkMode
                                                ? 'border-gray-600 hover:border-gray-500'
                                                : 'border-gray-300 hover:border-gray-400'
                                    )}
                                >
                                    <span className={cn("text-sm", isDarkMode ? "text-gray-200" : "text-gray-700")}>
                                        Transparent
                                    </span>
                                </button>
                                <input
                                    type="color"
                                    value={textBackgroundColor === 'transparent' ? '#ffffff' : textBackgroundColor}
                                    onChange={(e) => setTextBackgroundColor(e.target.value)}
                                    className="w-full h-8 rounded cursor-pointer"
                                    aria-label="Background color picker"
                                />
                                <div className="flex items-center gap-2">
                                    <div
                                        className="w-8 h-8 rounded border"
                                        style={{
                                            backgroundColor: textBackgroundColor === 'transparent' ? 'transparent' : textBackgroundColor,
                                            borderColor: isDarkMode ? '#4B5563' : '#D1D5DB',
                                            backgroundImage: textBackgroundColor === 'transparent' ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)' : 'none',
                                            backgroundSize: textBackgroundColor === 'transparent' ? '8px 8px' : 'auto',
                                            backgroundPosition: textBackgroundColor === 'transparent' ? '0 0, 0 4px, 4px -4px, -4px 0px' : 'auto'
                                        }}
                                    />
                                    <span className={cn("text-xs", isDarkMode ? "text-gray-400" : "text-gray-600")}>
                                        {textBackgroundColor === 'transparent' ? 'Transparent' : textBackgroundColor.toUpperCase()}
                                    </span>
                                </div>
                            </div>
                        )}

                        {!showBgColorPicker && (
                            <div className="flex items-center gap-2">
                                <div
                                    className="w-8 h-8 rounded border"
                                    style={{
                                        backgroundColor: textBackgroundColor === 'transparent' ? 'transparent' : textBackgroundColor,
                                        borderColor: isDarkMode ? '#4B5563' : '#D1D5DB',
                                        backgroundImage: textBackgroundColor === 'transparent' ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)' : 'none',
                                        backgroundSize: textBackgroundColor === 'transparent' ? '8px 8px' : 'auto',
                                        backgroundPosition: textBackgroundColor === 'transparent' ? '0 0, 0 4px, 4px -4px, -4px 0px' : 'auto'
                                    }}
                                />
                                <span className={cn("text-xs", isDarkMode ? "text-gray-400" : "text-gray-600")}>
                                    {textBackgroundColor === 'transparent' ? 'Transparent' : textBackgroundColor.toUpperCase()}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Font Family */}
                    <div>
                        <label
                            className={cn(
                                "block text-xs font-medium mb-2",
                                isDarkMode ? "text-gray-300" : "text-gray-700"
                            )}
                        >
                            Font Family
                        </label>
                        <select
                            value={textFontFamily}
                            onChange={(e) => setTextFontFamily(e.target.value)}
                            className={cn(
                                "w-full px-3 py-2 rounded border text-sm",
                                isDarkMode
                                    ? "bg-gray-700 border-gray-600 text-gray-200"
                                    : "bg-white border-gray-300 text-gray-700"
                            )}
                        >
                            {fontFamilies.map((font) => (
                                <option key={font.value} value={font.value}>
                                    {font.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Font Size */}
                    <div>
                        <label
                            className={cn(
                                "block text-xs font-medium mb-2",
                                isDarkMode ? "text-gray-300" : "text-gray-700"
                            )}
                        >
                            Font Size: {textFontSize}px
                        </label>
                        <input
                            type="range"
                            min="8"
                            max="72"
                            step="1"
                            value={textFontSize}
                            onChange={(e) => setTextFontSize(parseInt(e.target.value))}
                            className="w-full"
                            aria-label="Font size"
                        />
                    </div>

                    {/* Text Style Toggles */}
                    <div>
                        <label
                            className={cn(
                                "block text-xs font-medium mb-2",
                                isDarkMode ? "text-gray-300" : "text-gray-700"
                            )}
                        >
                            Text Style
                        </label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setTextBold(!textBold)}
                                className={cn(
                                    "p-2 rounded transition-all",
                                    textBold
                                        ? 'bg-blue-500 text-white'
                                        : isDarkMode
                                            ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                )}
                                aria-label="Toggle bold"
                                title="Bold"
                            >
                                <Bold size={16} />
                            </button>
                            <button
                                onClick={() => setTextItalic(!textItalic)}
                                className={cn(
                                    "p-2 rounded transition-all",
                                    textItalic
                                        ? 'bg-blue-500 text-white'
                                        : isDarkMode
                                            ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                )}
                                aria-label="Toggle italic"
                                title="Italic"
                            >
                                <Italic size={16} />
                            </button>
                            <button
                                onClick={() => setTextUnderline(!textUnderline)}
                                className={cn(
                                    "p-2 rounded transition-all",
                                    textUnderline
                                        ? 'bg-blue-500 text-white'
                                        : isDarkMode
                                            ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                )}
                                aria-label="Toggle underline"
                                title="Underline"
                            >
                                <Underline size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}





