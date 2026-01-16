import { useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { cn } from '@/lib/utils';


interface EraserOptionsProps {
    isOpen: boolean;
    onClose: () => void;
}

export function EraserOptions({ isOpen, onClose }: EraserOptionsProps) {
    const {
        annotationMode,
        eraserMode,
        setEraserMode,
        isDarkMode
    } = useDocumentStore();

    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen, onClose]);

    // Don't show if eraser is not active OR if not explicitly opened
    if (annotationMode !== 'eraser' || !isOpen) return null;

    return (
        <div
            ref={dropdownRef}
            className={cn(
                "absolute left-6 top-52 z-10 rounded-xl shadow-xl border", // Adjusted top position
                isDarkMode ? "bg-gray-800 border-gray-700" : "bg-white/95 backdrop-blur border-gray-200"
            )}
        >
            <button
                onClick={onClose}
                className={cn(
                    "w-full px-4 py-2 flex items-center justify-between gap-2 rounded-t-xl",
                    isDarkMode ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
                aria-label="Eraser options"
                aria-expanded={isOpen}
            >
                <span className={cn("text-sm font-medium", isDarkMode ? "text-gray-200" : "text-gray-700")}>
                    Eraser Options
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
                <div className="p-3 space-y-3 min-w-[200px]">
                    {/* Mode Selection */}
                    <div>
                        <label
                            className={cn(
                                "block text-xs font-medium mb-2",
                                isDarkMode ? "text-gray-300" : "text-gray-700"
                            )}
                        >
                            Eraser Mode
                        </label>
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="eraserMode"
                                    value="stroke"
                                    checked={eraserMode === 'stroke'}
                                    onChange={() => setEraserMode('stroke')}
                                    className="cursor-pointer"
                                />
                                <span className={cn("text-sm", isDarkMode ? "text-gray-300" : "text-gray-700")}>
                                    Stroke Eraser
                                </span>
                            </label>
                            <p className={cn("text-xs ml-6", isDarkMode ? "text-gray-500" : "text-gray-500")}>
                                Delete whole objects
                            </p>

                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="eraserMode"
                                    value="point"
                                    checked={eraserMode === 'point'}
                                    onChange={() => setEraserMode('point')}
                                    className="cursor-pointer"
                                />
                                <span className={cn("text-sm", isDarkMode ? "text-gray-300" : "text-gray-700")}>
                                    Point Eraser
                                </span>
                            </label>
                            <p className={cn("text-xs ml-6", isDarkMode ? "text-gray-500" : "text-gray-500")}>
                                Erase parts of objects
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
