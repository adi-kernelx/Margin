import { useRef, useEffect } from 'react';
import { ChevronDown, Type, Square } from 'lucide-react';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { cn } from '@/lib/utils';

interface SelectOptionsProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SelectOptions({ isOpen, onClose }: SelectOptionsProps) {
    const { selectionMode, setSelectionMode, isDarkMode } = useDocumentStore();
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

    if (!isOpen) return null;

    const modes: Array<{ value: 'text' | 'annotations' | 'text-annotation'; label: string; icon: typeof Type | typeof Square; description: string }> = [
        { value: 'text', label: 'PDF Text Selection', icon: Type, description: 'Select/copy underlying PDF text' },
        { value: 'annotations', label: 'Image & Shape Selection', icon: Square, description: 'Select, move, resize images and shapes' },
        { value: 'text-annotation', label: 'Text Box Selection', icon: Type, description: 'Select, move, edit text boxes' },
    ];

    return (
        <div
            ref={dropdownRef}
            className={cn(
                "absolute left-6 top-[calc(6rem+1rem)] z-10 rounded-xl shadow-xl border",
                isDarkMode ? "bg-gray-800 border-gray-700" : "bg-white/95 backdrop-blur border-gray-200"
            )}
        >
            <button
                onClick={onClose}
                className={cn(
                    "w-full px-4 py-2 flex items-center justify-between gap-2 rounded-t-xl",
                    isDarkMode ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
                aria-label="Selection options"
                aria-expanded={isOpen}
            >
                <span className={cn("text-sm font-medium", isDarkMode ? "text-gray-200" : "text-gray-700")}>
                    Selection Mode
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
                <div className="p-3 space-y-2 min-w-[240px]">
                    {modes.map((mode) => {
                        const Icon = mode.icon;
                        const isSelected = selectionMode === mode.value;
                        return (
                            <button
                                key={mode.value}
                                onClick={() => {
                                    setSelectionMode(mode.value);
                                    onClose();
                                }}
                                className={cn(
                                    "w-full px-3 py-2 rounded-lg text-left transition-all flex items-start gap-3",
                                    isSelected
                                        ? isDarkMode
                                            ? "bg-blue-600 text-white"
                                            : "bg-blue-500 text-white"
                                        : isDarkMode
                                            ? "hover:bg-gray-700 text-gray-200"
                                            : "hover:bg-gray-100 text-gray-700"
                                )}
                            >
                                <Icon size={18} className="mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-sm">{mode.label}</div>
                                    <div className={cn(
                                        "text-xs mt-0.5",
                                        isSelected ? "text-blue-50" : isDarkMode ? "text-gray-400" : "text-gray-500"
                                    )}>
                                        {mode.description}
                                    </div>
                                </div>
                                {isSelected && (
                                    <div className={cn(
                                        "w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
                                        isDarkMode ? "bg-white" : "bg-white"
                                    )} />
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}


