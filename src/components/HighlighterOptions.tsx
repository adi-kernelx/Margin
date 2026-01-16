import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Palette } from 'lucide-react';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { cn } from '@/lib/utils';

interface HighlighterOptionsProps {
    isOpen: boolean;
    onClose: () => void;
}

export function HighlighterOptions({ isOpen, onClose }: HighlighterOptionsProps) {
    const {
        annotationMode,
        highlighterMode,
        setHighlighterMode,
        highlighterColor,
        setHighlighterColor,
        highlighterOpacity,
        setHighlighterOpacity,
        isDarkMode
    } = useDocumentStore();

    const [showColorPicker, setShowColorPicker] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                onClose();
                setShowColorPicker(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen, onClose]);

    // Don't show if highlighter is not active OR if not explicitly opened
    if (annotationMode !== 'highlighter' || !isOpen) return null;

    const presetColors = [
        { name: 'Yellow', value: '#FFEB3B' },
        { name: 'Green', value: '#4CAF50' },
        { name: 'Blue', value: '#2196F3' },
        { name: 'Pink', value: '#E91E63' },
        { name: 'Orange', value: '#FF9800' },
        { name: 'Purple', value: '#9C27B0' },
    ];

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
                aria-label="Highlighter options"
                aria-expanded={isOpen}
            >
                <span className={cn("text-sm font-medium", isDarkMode ? "text-gray-200" : "text-gray-700")}>
                    Highlighter Options
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
                <div className="p-3 space-y-3 min-w-[280px]">
                    {/* Mode Selection */}
                    <div>
                        <label
                            className={cn(
                                "block text-xs font-medium mb-2",
                                isDarkMode ? "text-gray-300" : "text-gray-700"
                            )}
                        >
                            Mode
                        </label>
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="highlighterMode"
                                    value="freeform"
                                    checked={highlighterMode === 'freeform'}
                                    onChange={() => setHighlighterMode('freeform')}
                                    className="cursor-pointer"
                                />
                                <span className={cn("text-sm", isDarkMode ? "text-gray-300" : "text-gray-700")}>
                                    Free form
                                </span>
                            </label>
                            <p className={cn("text-xs ml-6", isDarkMode ? "text-gray-500" : "text-gray-500")}>
                                Draw anywhere
                            </p>

                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="highlighterMode"
                                    value="text-aware"
                                    checked={highlighterMode === 'text-aware'}
                                    onChange={() => setHighlighterMode('text-aware')}
                                    className="cursor-pointer"
                                />
                                <span className={cn("text-sm", isDarkMode ? "text-gray-300" : "text-gray-700")}>
                                    Selectable text only
                                </span>
                            </label>
                            <p className={cn("text-xs ml-6", isDarkMode ? "text-gray-500" : "text-gray-500")}>
                                Snap to words
                            </p>
                        </div>
                    </div>

                    {/* Color Picker */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label
                                className={cn(
                                    "text-xs font-medium",
                                    isDarkMode ? "text-gray-300" : "text-gray-700"
                                )}
                            >
                                Color
                            </label>
                            <button
                                onClick={() => setShowColorPicker(!showColorPicker)}
                                className={cn(
                                    "p-1 rounded hover:bg-opacity-20",
                                    isDarkMode ? "hover:bg-white" : "hover:bg-gray-200"
                                )}
                                aria-label="Change color"
                            >
                                <Palette size={16} className={isDarkMode ? "text-gray-400" : "text-gray-600"} />
                            </button>
                        </div>

                        {showColorPicker && (
                            <div className="space-y-2">
                                {/* Preset Colors */}
                                <div className="grid grid-cols-6 gap-2">
                                    {presetColors.map((color) => (
                                        <button
                                            key={color.value}
                                            onClick={() => setHighlighterColor(color.value)}
                                            className={cn(
                                                "w-8 h-8 rounded border-2 transition-all",
                                                highlighterColor === color.value
                                                    ? "border-blue-500 scale-110"
                                                    : isDarkMode
                                                        ? "border-gray-600 hover:border-gray-500"
                                                        : "border-gray-300 hover:border-gray-400"
                                            )}
                                            style={{ backgroundColor: color.value }}
                                            aria-label={`Select ${color.name} color`}
                                            title={color.name}
                                        />
                                    ))}
                                </div>

                                {/* Custom Color Input */}
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={highlighterColor}
                                        onChange={(e) => setHighlighterColor(e.target.value)}
                                        className="w-full h-8 rounded cursor-pointer"
                                        aria-label="Custom color picker"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Current Color Display */}
                        {!showColorPicker && (
                            <div className="flex items-center gap-2">
                                <div
                                    className="w-8 h-8 rounded border"
                                    style={{
                                        backgroundColor: highlighterColor,
                                        borderColor: isDarkMode ? '#4B5563' : '#D1D5DB'
                                    }}
                                />
                                <span className={cn("text-xs", isDarkMode ? "text-gray-400" : "text-gray-600")}>
                                    {highlighterColor.toUpperCase()}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Opacity Slider */}
                    <div>
                        <label
                            className={cn(
                                "block text-xs font-medium mb-2",
                                isDarkMode ? "text-gray-300" : "text-gray-700"
                            )}
                        >
                            Opacity: {Math.round(highlighterOpacity * 100)}%
                        </label>
                        <input
                            type="range"
                            min="0.1"
                            max="0.5"
                            step="0.05"
                            value={highlighterOpacity}
                            onChange={(e) => setHighlighterOpacity(parseFloat(e.target.value))}
                            className="w-full"
                            aria-label="Highlighter opacity"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

