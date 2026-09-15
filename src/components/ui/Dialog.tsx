import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from './IconButton';

interface DialogProps {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
    className?: string;
}

export function Dialog({ open, title, onClose, children, footer, className }: DialogProps) {
    const titleId = useId();
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        panelRef.current?.focus();
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [open, onClose]);

    if (!open) return null;
    return (
        <div className="fixed inset-0 z-dialog flex items-center justify-center bg-black/50 p-4" onPointerDown={(event) => {
            if (event.target === event.currentTarget) onClose();
        }}>
            <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cn('w-full max-w-md overflow-hidden rounded-xl border border-line bg-surface-3 text-text shadow-elev-4', className)}>
                <header className="flex min-h-12 items-center justify-between border-b border-line-soft px-4">
                    <h2 id={titleId} className="font-semibold">{title}</h2>
                    <IconButton aria-label={`Close ${title}`} onClick={onClose}><X size={18} /></IconButton>
                </header>
                <div className="p-4">{children}</div>
                {footer && <footer className="flex justify-end gap-2 border-t border-line-soft bg-surface-2 px-4 py-3">{footer}</footer>}
            </div>
        </div>
    );
}
