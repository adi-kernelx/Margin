import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ToolbarGroupProps extends HTMLAttributes<HTMLDivElement> {
    label: string;
    children: ReactNode;
    /** Draws a hairline divider before the group. */
    separated?: boolean;
    orientation?: 'vertical' | 'horizontal';
}

export function ToolbarGroup({ label, children, separated = false, orientation = 'vertical', className, ...props }: ToolbarGroupProps) {
    const vertical = orientation === 'vertical';
    return (
        <div
            role="group"
            aria-label={label}
            className={cn(
                'flex items-center gap-1',
                vertical ? 'flex-col' : 'flex-row',
                separated && (vertical ? 'border-t border-line-soft pt-1.5' : 'border-l border-line-soft pl-1.5'),
                className,
            )}
            {...props}
        >
            {children}
        </div>
    );
}
