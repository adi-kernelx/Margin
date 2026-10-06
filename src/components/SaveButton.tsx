import { useRef, type ButtonHTMLAttributes, type MouseEvent } from 'react';
import { Save } from 'lucide-react';
import { useSaveStore } from '@/lib/saving/save-manager';
import { cn } from '@/lib/utils';

export const useDocModified = (pdfId: string) => {
    return useSaveStore(state => !!state.isDirtyByPdf[pdfId]);
};

export const useGlobalModified = () => {
    return useSaveStore(state => Object.values(state.isDirtyByPdf).some(Boolean));
};

interface SaveButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'onDoubleClick'> {
    onSingleClick: () => void;
    onDoubleClick: () => void;
    /** Optional override for the store's dirty state, e.g. for a per-doc button. */
    isModified?: boolean;
    compact?: boolean;
}

export function SaveButton({
    onSingleClick,
    onDoubleClick,
    isModified,
    compact = false,
    className,
    disabled,
    ...props
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
            {...props}
            onClick={handleClick}
            disabled={disabled}
            aria-label={isModified ? 'Save (unsaved changes)' : 'Save'}
            className={cn(
                'relative grid shrink-0 place-items-center rounded-lg transition-[background-color,color] duration-state',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                compact ? 'size-8' : 'size-9 [@media(max-height:860px)]:size-8',
                isModified
                    ? 'bg-warning-soft text-warning hover:bg-warning-soft/80'
                    : 'text-text-soft hover:bg-sunken hover:text-text',
                disabled && 'cursor-not-allowed opacity-35',
                className,
            )}
        >
            <Save size={compact ? 16 : 18} />
            {isModified && (
                // Tint + dot + label: meaning never rides on colour alone,
                // and the pulse stops under reduced motion.
                <span className="absolute right-1 top-1 flex size-2" aria-hidden>
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-warning opacity-60 motion-reduce:animate-none" />
                    <span className="relative inline-flex size-2 rounded-full bg-warning ring-2 ring-surface-2" />
                </span>
            )}
        </button>
    );
}
