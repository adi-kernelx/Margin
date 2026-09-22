import { useRef, type MouseEvent } from 'react';
import { Save } from 'lucide-react';
import { useSaveStore } from '@/lib/saving/save-manager';
import { cn } from '@/lib/utils';

export const useDocModified = (pdfId: string) => {
    return useSaveStore(state => !!state.isDirtyByPdf[pdfId]);
};

export const useGlobalModified = () => {
    return useSaveStore(state => Object.values(state.isDirtyByPdf).some(Boolean));
};

interface SaveButtonProps {
    onSingleClick: () => void;
    onDoubleClick: () => void;
    /** Optional override for the store's dirty state, e.g. for a per-doc button. */
    isModified?: boolean;
    className?: string;
    disabled?: boolean;
}

export function SaveButton({
    onSingleClick,
    onDoubleClick,
    isModified,
    className,
    disabled,
}: SaveButtonProps) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleClick = (event: MouseEvent) => {
        if (disabled) return;

        // Wait a beat to see if the user is double-clicking. The heuristic is
        // native (event.detail: 1 = single, 2 = double); the timer defers the
        // single-click action until the OS's double-click window has passed.
        if (event.detail === 1) {
            timerRef.current = setTimeout(() => {
                onSingleClick();
                timerRef.current = null;
            }, 250);
        } else if (event.detail === 2) {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            onDoubleClick();
        }
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={disabled}
            title="Save (Ctrl+S) — double-click for options"
            aria-label="Save"
            className={cn(
                'depth-pressable relative flex h-11 w-11 items-center justify-center rounded-lg text-text-soft',
                'transition-colors duration-state hover:text-accent',
                disabled && 'cursor-not-allowed opacity-50',
                className,
            )}
        >
            <Save size={20} />
            {isModified && (
                // Colour + motion together — meaning does not ride on the
                // colour alone, and the pulse dies out under reduced motion.
                <span className="absolute right-2 top-2 flex h-2 w-2" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-warning" />
                </span>
            )}
        </button>
    );
}
