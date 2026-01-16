import { useRef, useEffect } from 'react';
import { ChevronDown, Upload } from 'lucide-react';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { cn } from '@/lib/utils';

interface ImageOptionsProps {
    isOpen: boolean;
    onClose: () => void;
    onImageSelect: (file: File) => void;
}

export function ImageOptions({ isOpen, onClose, onImageSelect }: ImageOptionsProps) {
    const {
        annotationMode,
        isDarkMode
    } = useDocumentStore();

    const dropdownRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    // Don't show if image tool is not active OR if not explicitly opened
    if (annotationMode !== 'image' || !isOpen) return null;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            // Call the global handler if available, otherwise use callback
            const globalHandler = (window as any).__handleImageFileUpload;
            if (globalHandler) {
                globalHandler(file);
            } else {
                onImageSelect(file);
            }
            onClose();
            // Reset file input
            e.target.value = '';
        }
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

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
                aria-label="Image options"
                aria-expanded={isOpen}
            >
                <span className={cn("text-sm font-medium", isDarkMode ? "text-gray-200" : "text-gray-700")}>
                    Image Options
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
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="hidden"
                        aria-label="Upload image"
                    />
                    <button
                        onClick={handleUploadClick}
                        className={cn(
                            "w-full px-4 py-2 rounded-lg flex items-center justify-center gap-2 transition-all",
                            isDarkMode
                                ? "bg-gray-700 text-gray-200 hover:bg-gray-600"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        )}
                    >
                        <Upload size={16} />
                        <span className="text-sm font-medium">Upload Image</span>
                    </button>
                    <p className={cn("text-xs text-center", isDarkMode ? "text-gray-400" : "text-gray-500")}>
                        Or click on the PDF to paste from clipboard
                    </p>
                </div>
            )}
        </div>
    );
}

