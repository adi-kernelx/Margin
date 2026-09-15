import { useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentOption<T extends string> {
    value: T;
    label: string;
    description?: string;
    icon?: ReactNode;
}

interface SegmentedControlProps<T extends string> {
    label: string;
    value: T;
    options: readonly SegmentOption<T>[];
    onChange: (value: T) => void;
    className?: string;
}

export function SegmentedControl<T extends string>({ label, value, options, onChange, className }: SegmentedControlProps<T>) {
    const name = useId();

    return (
        <fieldset className={cn('space-y-2', className)}>
            <legend className="mb-2 text-xs font-semibold text-text-soft">{label}</legend>
            <div className="grid gap-1 rounded-lg bg-sunken p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
                {options.map((option) => (
                    <label key={option.value} className="cursor-pointer">
                        <input
                            className="peer sr-only"
                            type="radio"
                            name={name}
                            value={option.value}
                            checked={value === option.value}
                            onChange={() => onChange(option.value)}
                        />
                        <span className="flex min-h-8 items-center justify-center gap-1 rounded px-2 text-center text-sm text-text-soft transition-colors duration-state peer-checked:bg-surface-2 peer-checked:text-accent peer-checked:shadow-elev-1 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
                            {option.icon}{option.label}
                        </span>
                        {option.description && <span className="sr-only">{option.description}</span>}
                    </label>
                ))}
            </div>
        </fieldset>
    );
}
