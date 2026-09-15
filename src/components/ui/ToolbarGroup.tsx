import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ToolbarGroupProps extends HTMLAttributes<HTMLDivElement> {
    label: string;
    children: ReactNode;
    separated?: boolean;
}

export function ToolbarGroup({ label, children, separated = false, className, ...props }: ToolbarGroupProps) {
    return (
        <div
            role="group"
            aria-label={label}
            className={cn(
                'flex flex-col items-center gap-2',
                separated && 'border-t border-line pt-2',
                className,
            )}
            {...props}
        >
            {children}
        </div>
    );
}
