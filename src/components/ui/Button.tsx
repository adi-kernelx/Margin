import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    leadingIcon?: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
    primary: 'border-accent bg-accent text-text-onaccent hover:bg-accent-hover',
    secondary: 'border-line bg-surface-2 text-text shadow-elev-1 hover:bg-surface-3',
    ghost: 'border-transparent bg-transparent text-text-soft hover:bg-surface-3 hover:text-text',
    danger: 'border-transparent bg-danger-soft text-danger hover:border-danger',
};

export function Button({
    variant = 'secondary',
    size = 'md',
    leadingIcon,
    className,
    children,
    type = 'button',
    ...props
}: ButtonProps) {
    return (
        <button
            type={type}
            className={cn(
                'inline-flex items-center justify-center gap-2 rounded border font-semibold transition-colors duration-state disabled:cursor-not-allowed disabled:opacity-50',
                size === 'sm' ? 'h-7 px-2 text-sm' : 'h-9 px-3 text-base',
                variants[variant],
                className,
            )}
            {...props}
        >
            {leadingIcon}
            {children}
        </button>
    );
}
