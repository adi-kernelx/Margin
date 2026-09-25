// StatusBar — the app's bottom bar.
//
// Reads the workspace's active document from the app store and the service
// health poller for the OCR/RAG dots. Rendered once by Dashboard beneath the
// document panes; sits at elevation 1 so it reads as chrome, not as the
// document surface.

import { useMemo } from 'react';
import type { DocumentEntry } from '@/types';
import { useAppStore } from '@/lib/store';
import { useSaveStore, type SaveStoreState } from '@/lib/saving/save-manager';
import { SERVICES_ENABLED } from '@/lib/features';
import { SERVICES, useServiceHealthStore, type ServiceHealth, type ServiceKey } from '@/lib/services/health';
import { cn } from '@/lib/utils';

interface StatusBarProps {
    documents: DocumentEntry[];
    /** The current pane count is not in the store; Dashboard passes it directly. */
    paneCount: number;
}

function HealthDot({ state, label, provides }: { state: ServiceHealth; label: string; provides: string }) {
    // Deliberately colour AND text: elevation-1 chrome cannot rely on colour
    // alone, and colour-blind users need the tooltip to say which is which.
    const styles = state === 'online'
        ? 'bg-success text-success'
        : state === 'offline'
            ? 'bg-danger text-danger'
            : 'bg-warning text-warning';
    const title = state === 'online'
        ? `${label}: online — ${provides}`
        : state === 'offline'
            ? `${label}: offline — ${provides} unavailable`
            : `${label}: checking…`;
    return (
        <span
            role="status"
            aria-label={title}
            title={title}
            className={cn(
                'inline-flex items-center gap-1.5 text-xs font-mono',
            )}
        >
            <span className={cn('h-2 w-2 rounded-full', styles.split(' ')[0])} aria-hidden />
            <span className="text-text-muted">{label}</span>
        </span>
    );
}

export function StatusBar({ documents, paneCount }: StatusBarProps) {
    const focusedDocId = useAppStore(state => state.focusedDocId);
    const scale = useAppStore(state => state.scale);
    const isDirtyByPdf = useSaveStore((state: SaveStoreState) => state.isDirtyByPdf);
    const healthByKey = useServiceHealthStore(state => state.byKey);

    const focused = useMemo(
        () => documents.find(d => d.id === focusedDocId),
        [documents, focusedDocId],
    );

    const dirtyCount = useMemo(
        () => Object.values(isDirtyByPdf).filter(Boolean).length,
        [isDirtyByPdf],
    );

    const saveLabel = dirtyCount === 0
        ? 'All saved'
        : `${dirtyCount} unsaved`;

    return (
        <footer
            role="contentinfo"
            className={cn(
                'h-7 flex items-center justify-between px-3 border-t border-line bg-surface-1',
                'text-xs text-text-muted flex-shrink-0 select-none',
                'shadow-elev-1',
            )}
        >
            <div className="flex items-center gap-4 min-w-0">
                <span className="truncate max-w-[240px]" title={focused?.name ?? 'No document open'}>
                    {focused?.name ?? 'No document open'}
                </span>
                <span aria-hidden className="text-line">•</span>
                <span className="font-mono">{Math.round(scale * 100)}%</span>
                <span aria-hidden className="text-line">•</span>
                <span>{paneCount} pane{paneCount === 1 ? '' : 's'}</span>
                {documents.length > 0 && (
                    <>
                        <span aria-hidden className="text-line">•</span>
                        <span>{documents.length} open</span>
                    </>
                )}
            </div>

            <div className="flex items-center gap-4">
                <span className={cn(dirtyCount > 0 && 'text-warning')}>{saveLabel}</span>
                {SERVICES_ENABLED && <span aria-hidden className="text-line">•</span>}
                {SERVICES_ENABLED && SERVICES.map(descriptor => (
                    <HealthDot
                        key={descriptor.key satisfies ServiceKey}
                        state={healthByKey[descriptor.key]}
                        label={descriptor.label}
                        provides={descriptor.provides}
                    />
                ))}
            </div>
        </footer>
    );
}
