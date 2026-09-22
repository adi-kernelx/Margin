import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { IconButton } from './ui/IconButton';
import { ToolbarGroup } from './ui/ToolbarGroup';
import { cn } from '@/lib/utils';

interface PaneHeaderProps {
    filename: string;
    onClose: () => void;
    className?: string;
}

export function PaneHeader({ filename, onClose, className }: PaneHeaderProps) {
    const scale = useDocumentStore(state => state.scale);
    const setScale = useDocumentStore(state => state.setScale);

    return (
        <div
            className={cn(
                'flex h-10 flex-shrink-0 select-none items-center justify-between border-b border-line',
                'bg-surface-2 px-3 text-text shadow-elev-1',
                className,
            )}
        >
            <div className="flex min-w-0 items-center gap-2">
                <span
                    className="max-w-[220px] truncate text-sm font-medium text-text"
                    title={filename}
                >
                    {filename}
                </span>
                <IconButton size="sm" onClick={onClose} aria-label={`Close ${filename}`} title="Close">
                    <X size={14} />
                </IconButton>
            </div>

            <ToolbarGroup label="Zoom">
                <IconButton
                    size="sm"
                    onClick={() => setScale(Math.max(0.5, scale - 0.1))}
                    aria-label="Zoom out"
                    title="Zoom out"
                >
                    <ZoomOut size={14} />
                </IconButton>
                <span className="w-10 text-center font-mono text-xs text-text-muted">
                    {Math.round(scale * 100)}%
                </span>
                <IconButton
                    size="sm"
                    onClick={() => setScale(Math.min(5, scale + 0.1))}
                    aria-label="Zoom in"
                    title="Zoom in"
                >
                    <ZoomIn size={14} />
                </IconButton>
            </ToolbarGroup>
        </div>
    );
}
