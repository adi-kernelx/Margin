import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
    children: ReactNode;
    'aria-label': string;
    pressed?: boolean;
    size?: 'sm' | 'md' | 'lg';
}

const sizes = {
    sm: 'size-7',
    md: 'size-8',
    lg: 'size-11',
} as const;

export function IconButton({ children, className, pressed = false, size = 'md', type = 'button', ...props }: IconButtonProps) {
    return (
        <button
            type={type}
            className={cn(
                'inline-grid shrink-0 place-items-center rounded border border-transparent bg-surface-2 text-text-soft transition-colors duration-state hover:bg-surface-3 hover:text-text disabled:cursor-not-allowed disabled:opacity-50',
                sizes[size],
                pressed && 'border-accent bg-accent-soft text-accent',
                className,
            )}
            aria-pressed={pressed || undefined}
            {...props}
        >
            {children}
        </button>
    );
}
