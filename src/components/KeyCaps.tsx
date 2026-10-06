import { shortcutLabel } from '@/core/ui/shortcuts';
import { IS_MAC } from '@/lib/commands/registry';
import { cn } from '@/lib/utils';

interface KeyCapsProps {
    shortcut: string;
    /** "inverse" for use on dark surfaces such as tooltips. */
    tone?: 'default' | 'inverse';
    className?: string;
}

/** A shortcut rendered as physical key caps, with the platform's modifier names. */
export function KeyCaps({ shortcut, tone = 'default', className }: KeyCapsProps) {
    const caps = shortcutLabel(shortcut, IS_MAC);
    return (
        <span className={cn('inline-flex items-center gap-0.5', className)} aria-label={caps.join(' ')}>
            {caps.map((cap, index) => (
                <kbd
                    key={index}
                    className={cn('keycap', tone === 'inverse' && 'border-transparent bg-surface-1/15 text-surface-1 shadow-none')}
                >
                    {cap}
                </kbd>
            ))}
        </span>
    );
}
