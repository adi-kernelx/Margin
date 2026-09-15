import { cloneElement, useId } from 'react';
import type { ReactElement } from 'react';

interface TooltipProps {
    content: string;
    children: ReactElement<{ 'aria-describedby'?: string }>;
}

export function Tooltip({ content, children }: TooltipProps) {
    const id = useId();
    return (
        <span className="group/tooltip relative inline-flex">
            {cloneElement(children, { 'aria-describedby': id })}
            <span id={id} role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-popover mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-text px-2 py-1 text-xs text-surface-1 opacity-0 shadow-elev-2 transition-opacity duration-state group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100">
                {content}
            </span>
        </span>
    );
}
