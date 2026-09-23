import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './Button';

interface EmptyStateProps {
    title: string;
    description?: ReactNode;
    /** Isometric artwork or an icon; defaults to a small stack of pages. */
    art?: ReactNode;
    action?: ReactNode;
    className?: string;
    compact?: boolean;
}

/** Three stacked sheets under the iso transform — the default empty artwork. */
export function PaperStackArt({ size = 72 }: { size?: number }) {
    return (
        <div className="iso-scene relative" style={{ width: size, height: size }} aria-hidden="true">
            {[0, 1, 2].map(layer => (
                <div
                    key={layer}
                    className="absolute inset-[18%] rounded-sm border border-line bg-surface-1 shadow-elev-1"
                    style={{ translate: `0 ${-layer * 7}px`, opacity: 1 - layer * 0.12 }}
                />
            ))}
        </div>
    );
}

export function EmptyState({ title, description, art, action, className, compact = false }: EmptyStateProps) {
    return (
        <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 p-4' : 'gap-3 p-8', className)}>
            {art ?? <PaperStackArt size={compact ? 52 : 72} />}
            <h3 className={cn('font-semibold text-text', compact ? 'text-sm' : 'text-md')}>{title}</h3>
            {description && <p className="max-w-xs text-sm leading-relaxed text-text-muted">{description}</p>}
            {action && <div className="mt-1">{action}</div>}
        </div>
    );
}

interface ErrorStateProps {
    title: string;
    description?: ReactNode;
    onRetry?: () => void;
    retryLabel?: string;
    className?: string;
}

export function ErrorState({ title, description, onRetry, retryLabel = 'Try again', className }: ErrorStateProps) {
    return (
        <div role="alert" className={cn('flex flex-col items-center justify-center gap-3 p-6 text-center', className)}>
            <span className="grid size-10 place-items-center rounded-full border border-danger bg-danger-soft text-danger">
                <AlertTriangle size={18} />
            </span>
            <h3 className="text-sm font-semibold text-text">{title}</h3>
            {description && <p className="max-w-xs text-sm leading-relaxed text-text-muted">{description}</p>}
            {onRetry && <Button size="sm" onClick={onRetry}>{retryLabel}</Button>}
        </div>
    );
}

interface SkeletonProps {
    className?: string;
    /** Renders this many text-like lines, the last one shorter. */
    lines?: number;
}

export function Skeleton({ className, lines }: SkeletonProps) {
    if (!lines) return <div className={cn('skeleton h-4', className)} aria-hidden="true" />;
    return (
        <div className={cn('space-y-2', className)} aria-hidden="true">
            {Array.from({ length: lines }, (_, index) => (
                <div key={index} className="skeleton h-3" style={{ width: index === lines - 1 ? '60%' : '100%' }} />
            ))}
        </div>
    );
}
