import type { ReactNode } from 'react';
import { LayoutGrid, ListTree, StickyNote } from 'lucide-react';
import type { DockTab } from '@/lib/ui/dock';
import { cn } from '@/lib/utils';
import { Tooltip } from './ui/Tooltip';

interface DocumentPanelBarProps {
    dockTab: DockTab | null;
    onToggle: (tab: DockTab) => void;
    noteCount: number;
    pageCount: number;
    onOrganisePages: () => void;
    canOrganise: boolean;
}

interface PanelButtonProps {
    icon: ReactNode;
    label: string;
    tooltip: string;
    shortcut: string;
    active?: boolean;
    badge?: number;
    disabled?: boolean;
    onClick: () => void;
}

function PanelButton({ icon, label, tooltip, shortcut, active = false, badge, disabled, onClick }: PanelButtonProps) {
    return (
        <Tooltip side="bottom" content={tooltip} shortcut={shortcut}>
            <button
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={onClick}
                className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors duration-state',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                    'disabled:cursor-not-allowed disabled:opacity-40',
                    active
                        ? 'bg-accent-soft text-accent shadow-[var(--edge-highlight)]'
                        : 'text-text-soft hover:bg-sunken hover:text-text',
                )}
            >
                {icon}
                <span>{label}</span>
                {badge !== undefined && badge > 0 && (
                    <span
                        className={cn(
                            'min-w-[18px] rounded-full px-1 text-center text-[10px] font-bold leading-[16px] tabular-nums',
                            active ? 'bg-accent text-text-onaccent' : 'bg-sunken text-text-muted',
                        )}
                    >
                        {badge}
                    </span>
                )}
            </button>
        </Tooltip>
    );
}

/**
 * The reader's floating switcher for its side panels and the page organiser:
 * one raised pill so the three read as a set, with the open panel pressed in.
 */
export function DocumentPanelBar({ dockTab, onToggle, noteCount, pageCount, onOrganisePages, canOrganise }: DocumentPanelBarProps) {
    return (
        <div
            role="toolbar"
            aria-label="Document panels"
            className="depth-float absolute right-4 top-4 z-20 flex items-center gap-0.5 rounded-xl border border-line-soft p-1"
        >
            <PanelButton
                icon={<StickyNote size={15} />}
                label="Notes"
                tooltip={dockTab === 'notes' ? 'Hide notes' : 'Show notes'}
                shortcut="Mod+Shift+N"
                active={dockTab === 'notes'}
                badge={noteCount}
                onClick={() => onToggle('notes')}
            />
            <PanelButton
                icon={<ListTree size={15} />}
                label="Outline"
                tooltip={dockTab === 'outline' ? 'Hide outline' : 'Show outline'}
                shortcut="Mod+Shift+O"
                active={dockTab === 'outline'}
                onClick={() => onToggle('outline')}
            />
            <span aria-hidden className="mx-1 h-5 w-px bg-line" />
            <PanelButton
                icon={<LayoutGrid size={15} />}
                label="Pages"
                tooltip={canOrganise ? 'Reorder, rotate, split and merge pages' : 'Read-only document'}
                shortcut="Mod+Shift+P"
                badge={pageCount}
                disabled={!canOrganise}
                onClick={onOrganisePages}
            />
        </div>
    );
}
