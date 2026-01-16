
import React from 'react';
import { Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSaveStore } from '@/lib/saving/save-manager';
import { useAppStore } from '@/lib/store';

export const useDocModified = (pdfId: string) => {
    return useSaveStore((state) => !!state.isDirtyByPdf[pdfId]);
};

export const useGlobalModified = () => {
    return useSaveStore((state) => Object.values(state.isDirtyByPdf).some(Boolean));
};

interface SaveButtonProps {
    onSingleClick: () => void;
    onDoubleClick: () => void;
    isModified?: boolean; // Prop to override store isDirty
    className?: string;
    disabled?: boolean;
}

export function SaveButton({
    onSingleClick,
    onDoubleClick,
    isModified,
    className,
    disabled
}: SaveButtonProps) {
    const { isDarkMode } = useAppStore();

    // ... (handleClick same)

    const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleClick = (e: React.MouseEvent) => {
        if (disabled) return;

        // Native detail logic: 1 = single, 2 = double, 3 = triple...
        // Note: Logic relies on the fact that click (detail 1) fires, then click (detail 2) fires.

        if (e.detail === 1) {
            // Wait to see if a second click comes
            timerRef.current = setTimeout(() => {
                onSingleClick();
                timerRef.current = null;
            }, 250);
        } else if (e.detail === 2) {
            // Second click happened within system double-click time
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            onDoubleClick();
        }
    };

    return (
        <button
            onClick={handleClick}
            // onDoubleClick handled by handleClick timer
            disabled={disabled}
            className={cn(
                'p-3 rounded-lg transition-all relative group',
                disabled && 'opacity-50 cursor-not-allowed',
                isDarkMode
                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                className
            )}
            title="Save (Ctrl+S) - Double-click for options"
        >
            <Save size={20} />
            {isModified && (
                <span className="absolute top-2 right-2 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
            )}
        </button>
    );
}
