import { cloneElement, useCallback, useEffect, useId, useState } from 'react';
import type { FocusEvent, PointerEvent, ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { KeyCaps } from '../KeyCaps';

type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

interface TriggerProps {
    'aria-describedby'?: string;
    onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
    onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
    onFocus?: (event: FocusEvent<HTMLElement>) => void;
    onBlur?: (event: FocusEvent<HTMLElement>) => void;
}

interface TooltipProps {
    content: string;
    /** Optional shortcut rendered as key caps, e.g. "Mod+Z" or "P". */
    shortcut?: string;
    /** A second, quieter line, e.g. "Double-click for options". */
    hint?: string;
    side?: TooltipSide;
    children: ReactElement<TriggerProps>;
}

const HOVER_DELAY_MS = 350;
const GAP = 10;

function positionFor(rect: DOMRect, side: TooltipSide) {
    switch (side) {
        case 'right': return { left: rect.right + GAP, top: rect.top + rect.height / 2, transform: 'translateY(-50%)' };
        case 'left': return { left: rect.left - GAP, top: rect.top + rect.height / 2, transform: 'translate(-100%, -50%)' };
        case 'bottom': return { left: rect.left + rect.width / 2, top: rect.bottom + GAP, transform: 'translateX(-50%)' };
        default: return { left: rect.left + rect.width / 2, top: rect.top - GAP, transform: 'translate(-50%, -100%)' };
    }
}

/**
 * Tooltip rendered in a portal at a fixed position, so it escapes scrolling
 * and clipping containers such as the tool dock. Shows after a short delay on
 * hover — sweeping across a toolbar does not flash every label — and at once
 * on keyboard focus.
 */
export function Tooltip({ content, shortcut, hint, side = 'top', children }: TooltipProps) {
    const id = useId();
    const [anchor, setAnchor] = useState<DOMRect | null>(null);
    // Hover arms a pending position; the effect below promotes it after the delay.
    const [pending, setPending] = useState<DOMRect | null>(null);

    const hide = useCallback(() => {
        setPending(null);
        setAnchor(null);
    }, []);

    useEffect(() => {
        if (!pending) return;
        const timer = window.setTimeout(() => setAnchor(pending), HOVER_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [pending]);

    useEffect(() => {
        if (!anchor) return;
        // Any scroll or resize moves the trigger; hiding is simpler and less
        // jarring than chasing it.
        window.addEventListener('scroll', hide, true);
        window.addEventListener('resize', hide);
        return () => {
            window.removeEventListener('scroll', hide, true);
            window.removeEventListener('resize', hide);
        };
    }, [anchor, hide]);

    const trigger = cloneElement(children, {
        'aria-describedby': id,
        onPointerEnter: (event: PointerEvent<HTMLElement>) => {
            children.props.onPointerEnter?.(event);
            if (event.pointerType === 'touch') return;
            setPending(event.currentTarget.getBoundingClientRect());
        },
        onPointerLeave: (event: PointerEvent<HTMLElement>) => {
            children.props.onPointerLeave?.(event);
            hide();
        },
        onFocus: (event: FocusEvent<HTMLElement>) => {
            children.props.onFocus?.(event);
            if (event.currentTarget.matches(':focus-visible')) setAnchor(event.currentTarget.getBoundingClientRect());
        },
        onBlur: (event: FocusEvent<HTMLElement>) => {
            children.props.onBlur?.(event);
            hide();
        },
    });

    return (
        <>
            {trigger}
            {/* Always in the DOM so aria-describedby resolves; hidden until shown. */}
            {createPortal(
                <span
                    id={id}
                    role="tooltip"
                    hidden={!anchor}
                    style={anchor ? positionFor(anchor, side) : undefined}
                    className={cn(
                        'pointer-events-none fixed z-[60] max-w-xs rounded-md bg-text px-2 py-1.5 text-xs text-surface-1 shadow-elev-3',
                        'animate-[dialog-scrim_var(--dur-state)_var(--ease)]',
                    )}
                >
                    <span className="flex items-center gap-2 whitespace-nowrap">
                        <span className="font-medium">{content}</span>
                        {shortcut && <KeyCaps shortcut={shortcut} tone="inverse" />}
                    </span>
                    {hint && <span className="mt-0.5 block whitespace-nowrap text-[11px] opacity-70">{hint}</span>}
                </span>,
                document.body,
            )}
        </>
    );
}
