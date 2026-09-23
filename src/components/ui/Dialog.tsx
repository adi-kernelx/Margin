import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from './IconButton';

type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

interface DialogProps {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
    description?: string;
    icon?: ReactNode;
    size?: DialogSize;
    /** Blocks Escape, scrim click and the close button, e.g. while saving. */
    dismissible?: boolean;
    className?: string;
    bodyClassName?: string;
}

const sizes: Record<DialogSize, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
    open,
    title,
    onClose,
    children,
    footer,
    description,
    icon,
    size = 'md',
    dismissible = true,
    className,
    bodyClassName,
}: DialogProps) {
    const titleId = useId();
    const descriptionId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    const dismissibleRef = useRef(dismissible);
    useLayoutEffect(() => {
        onCloseRef.current = onClose;
        dismissibleRef.current = dismissible;
    });

    useEffect(() => {
        if (!open) return;
        // Remember what had focus so closing returns the user to where they
        // were, then move focus inside unless a child already claimed it
        // (e.g. an autoFocus input).
        const previous = document.activeElement as HTMLElement | null;
        const panel = panelRef.current;
        if (panel && !panel.contains(document.activeElement)) panel.focus();

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && dismissibleRef.current) {
                event.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab' || !panel) return;
            const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => element.offsetParent !== null);
            if (!focusable.length) {
                event.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            if (previous && document.contains(previous)) previous.focus();
        };
    }, [open]);

    if (!open) return null;
    return createPortal(
        <div
            className="fixed inset-0 z-dialog flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px] animate-[dialog-scrim_var(--dur-surface)_var(--ease)]"
            onPointerDown={(event) => {
                if (event.target === event.currentTarget && dismissible) onClose();
            }}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={description ? descriptionId : undefined}
                tabIndex={-1}
                className={cn(
                    'flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-line bg-surface-3 text-text shadow-elev-4 outline-none',
                    'animate-[dialog-in_var(--dur-entrance)_var(--ease)]',
                    sizes[size],
                    className,
                )}
            >
                <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-line-soft px-4 py-2 shadow-[var(--edge-highlight)]">
                    <div className="flex min-w-0 items-center gap-2">
                        {icon && <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{icon}</span>}
                        <div className="min-w-0">
                            <h2 id={titleId} className="truncate font-semibold">{title}</h2>
                            {description && <p id={descriptionId} className="truncate text-xs text-text-muted">{description}</p>}
                        </div>
                    </div>
                    <IconButton aria-label={`Close ${title}`} onClick={onClose} disabled={!dismissible}><X size={18} /></IconButton>
                </header>
                <div className={cn('min-h-0 flex-1 overflow-y-auto p-4', bodyClassName)}>{children}</div>
                {footer && <footer className="flex shrink-0 justify-end gap-2 border-t border-line-soft bg-surface-2 px-4 py-3">{footer}</footer>}
            </div>
        </div>,
        document.body,
    );
}
