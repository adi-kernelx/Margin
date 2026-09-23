import { useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: ReactNode;
    description?: ReactNode;
    disabled?: boolean;
    className?: string;
}

/**
 * A physical toggle: the thumb is a raised key that slides along a sunken
 * track. State is carried by position and text, never by colour alone.
 */
export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
    const labelId = useId();
    const descriptionId = useId();
    return (
        <div className={cn('flex items-center justify-between gap-4', className)}>
            <div className="min-w-0">
                <div id={labelId} className="text-sm font-medium text-text">{label}</div>
                {description && <div id={descriptionId} className="text-xs text-text-muted">{description}</div>}
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-labelledby={labelId}
                aria-describedby={description ? descriptionId : undefined}
                disabled={disabled}
                onClick={() => onChange(!checked)}
                className={cn(
                    'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-state disabled:cursor-not-allowed disabled:opacity-50',
                    'shadow-[var(--edge-press)]',
                    checked ? 'border-accent bg-accent' : 'border-line bg-sunken',
                )}
            >
                <span
                    className={cn(
                        'absolute top-0.5 size-[18px] rounded-full border border-line bg-surface-1 shadow-elev-1 transition-transform duration-state',
                        checked ? 'translate-x-[20px]' : 'translate-x-0.5',
                    )}
                />
                <span className="sr-only">{checked ? 'On' : 'Off'}</span>
            </button>
        </div>
    );
}
