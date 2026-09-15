import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from './IconButton';

interface PopoverProps {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
    className?: string;
}

export function Popover({ open, title, onClose, children, className }: PopoverProps) {
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const closeOnOutsidePointer = (event: PointerEvent) => {
            if (!panelRef.current?.contains(event.target as Node)) onClose();
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('pointerdown', closeOnOutsidePointer);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsidePointer);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [open, onClose]);

    if (!open) return null;
    return (
        <div ref={panelRef} role="dialog" aria-label={title} className={cn('absolute z-popover min-w-56 overflow-hidden rounded-xl border border-line bg-surface-3 text-text shadow-elev-3', className)}>
            <div className="flex min-h-10 items-center justify-between border-b border-line-soft px-3">
                <h2 className="text-sm font-semibold">{title}</h2>
                <IconButton size="sm" aria-label={`Close ${title}`} onClick={onClose}><X size={14} /></IconButton>
            </div>
            <div className="p-3">{children}</div>
        </div>
    );
}
