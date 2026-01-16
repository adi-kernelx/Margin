import { useState, useRef, useEffect } from 'react';
import { Palette } from 'lucide-react';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { cn } from '@/lib/utils';

interface ColorPickerProps {
    isOpen: boolean;
    onClose: () => void;
    toolMode: 'pencil' | 'rectangle' | 'arrow';
}

export function ColorPicker({ isOpen, onClose, toolMode }: ColorPickerProps) {
    const {
        annotationMode,
        pencilColor,
        setPencilColor,
        rectangleColor,
        setRectangleColor,
        arrowColor,
        setArrowColor,
        isDarkMode
    } = useDocumentStore();

    const [showColorPicker, setShowColorPicker] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Get current color and setter based on tool mode
    const currentColor = toolMode === 'pencil' ? pencilColor
        : toolMode === 'rectangle' ? rectangleColor
            : arrowColor;

    const setColor = toolMode === 'pencil' ? setPencilColor
        : toolMode === 'rectangle' ? setRectangleColor
            : setArrowColor;

    const toolName = toolMode.charAt(0).toUpperCase() + toolMode.slice(1);

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

    // Don't show if tool is not active OR if not explicitly opened
    if (annotationMode !== toolMode || !isOpen) return null;

    const presetColors = [
        { name: 'Black', value: '#000000' },
        { name: 'Red', value: '#FF0000' },
        { name: 'Blue', value: '#0000FF' },
        { name: 'Green', value: '#00FF00' },
        { name: 'Orange', value: '#FF9800' },
        { name: 'Purple', value: '#9C27B0' },
        { name: 'Pink', value: '#E91E63' },
        { name: 'Teal', value: '#009688' },
        { name: 'Brown', value: '#795548' },
        { name: 'Gray', value: '#9E9E9E' },
        { name: 'Cyan', value: '#00BCD4' },
        { name: 'Lime', value: '#CDDC39' },
    ];

    return (
        <div
            ref={dropdownRef}
            className={cn(
                "absolute left-20 top-24 z-10 rounded-xl shadow-xl border",
                isDarkMode ? "bg-gray-800 border-gray-700" : "bg-white/95 backdrop-blur border-gray-200"
            )}
        >
            <div
                className={cn(
                    "px-4 py-3 rounded-t-xl border-b",
                    isDarkMode ? "border-gray-700" : "border-gray-200"
                )}
            >
                <span className={cn("text-sm font-medium", isDarkMode ? "text-gray-200" : "text-gray-700")}>
                    {toolName} Color
                </span>
            </div>

            <div className="p-4 space-y-3 min-w-[260px]">
                {/* Color Picker Toggle */}
                <div className="flex items-center justify-between">
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
                        aria-label="Toggle color picker"
                    >
                        <Palette size={16} className={isDarkMode ? "text-gray-400" : "text-gray-600"} />
                    </button>
                </div>

                {showColorPicker && (
                    <div className="space-y-3">
                        {/* Preset Colors */}
                        <div className="grid grid-cols-6 gap-2">
                            {presetColors.map((color) => (
                                <button
                                    key={color.value}
                                    onClick={() => setColor(color.value)}
                                    className={cn(
                                        "w-8 h-8 rounded border-2 transition-all",
                                        currentColor === color.value
                                            ? "border-blue-500 scale-110 shadow-md"
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
                                value={currentColor}
                                onChange={(e) => setColor(e.target.value)}
                                className="w-full h-10 rounded cursor-pointer border"
                                aria-label="Custom color picker"
                            />
                        </div>
                    </div>
                )}

                {/* Current Color Display */}
                {!showColorPicker && (
                    <div className="flex items-center gap-3">
                        <div
                            className="w-12 h-12 rounded-lg border-2 shadow-sm"
                            style={{
                                backgroundColor: currentColor,
                                borderColor: isDarkMode ? '#4B5563' : '#D1D5DB'
                            }}
                        />
                        <div className="flex flex-col">
                            <span className={cn("text-xs font-medium", isDarkMode ? "text-gray-300" : "text-gray-600")}>
                                Current Color
                            </span>
                            <span className={cn("text-xs font-mono", isDarkMode ? "text-gray-400" : "text-gray-500")}>
                                {currentColor.toUpperCase()}
                            </span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
