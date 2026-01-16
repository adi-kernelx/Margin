import { ZoomIn, ZoomOut } from 'lucide-react';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { cn } from '@/lib/utils';

interface PaneHeaderProps {
    filename: string;
    onClose: () => void;
    className?: string; // Add className prop
}

export function PaneHeader({ filename, onClose, className }: PaneHeaderProps) {
    const { scale, setScale, isDarkMode } = useDocumentStore();

    return (
        <div className={cn(
            "h-10 flex items-center justify-between px-3 border-b flex-shrink-0 select-none",
            isDarkMode ? "bg-gray-800 border-gray-700 text-gray-200" : "bg-white border-gray-200 text-gray-700",
            className
        )}>
            <div className="flex items-center gap-3 overflow-hidden">
                <span className="font-medium text-sm truncate max-w-[150px]" title={filename}>
                    {filename}
                </span>
                <div className="h-4 w-px bg-gray-300 dark:bg-gray-600" />
                <button
                    onClick={onClose}
                    className="text-xs px-2 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-red-500 hover:text-red-600 transition-colors"
                >
                    Close
                </button>
            </div>

            <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded p-0.5">
                    <button
                        onClick={() => setScale(Math.max(0.5, scale - 0.1))}
                        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                        title="Zoom Out"
                    >
                        <ZoomOut size={14} />
                    </button>
                    <span className="text-xs w-10 text-center font-mono">{Math.round(scale * 100)}%</span>
                    <button
                        onClick={() => setScale(Math.min(5.0, scale + 0.1))}
                        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                        title="Zoom In"
                    >
                        <ZoomIn size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
}
