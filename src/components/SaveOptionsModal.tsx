import { saveManager, useSaveStore } from '@/lib/saving/save-manager';
import type { SaveStoreState } from '@/lib/saving/save-manager';
import { cn } from '@/lib/utils';
import { AlertTriangle, Braces, CheckCircle2, FileDown, HardDrive, Layers, Loader2, Package, Save } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { Switch } from './ui/Switch';
import { EmptyState } from './ui/States';

interface SaveOptionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    mode: 'global' | 'local';
    docId?: string; // If local, which doc
}

interface NeedsUserAction {
    reason: 'no-handle' | 'no-permission' | 'error';
    message?: string;
}

export function SaveOptionsModal({ isOpen, onClose, mode, docId }: SaveOptionsModalProps) {
    return (
        <Dialog
            open={isOpen}
            onClose={onClose}
            size="lg"
            icon={<Save size={16} />}
            title={mode === 'global' ? 'Save and export — all documents' : 'Save and export'}
            description="Everything is written locally. Nothing leaves this machine."
            footer={<Button onClick={onClose}>Done</Button>}
        >
            {isOpen && <DocsList mode={mode} targetDocId={docId} />}
        </Dialog>
    );
}

type ExportKind = 'save' | 'flatten' | 'json' | 'package';

const exportOptions: { kind: ExportKind; title: string; description: string; icon: ReactNode }[] = [
    { kind: 'save', title: 'PDF, editable annotations', description: 'Write back to the original file. Annotations stay editable in Margin.', icon: <Save size={18} /> },
    { kind: 'flatten', title: 'Flattened PDF', description: 'Burn annotations into the page. Opens the same in any reader.', icon: <Layers size={18} /> },
    { kind: 'json', title: 'Margin JSON', description: 'Annotations and notes only — small, diff-able, re-importable.', icon: <Braces size={18} /> },
    { kind: 'package', title: 'Complete package', description: 'Original PDF, flattened PDF and JSON in one archive.', icon: <Package size={18} /> },
];

function DocsList({ mode, targetDocId }: { mode: 'global' | 'local'; targetDocId?: string }) {
    const isDirtyByPdf = useSaveStore((state: SaveStoreState) => state.isDirtyByPdf);
    const autosaveEnabledByPdf = useSaveStore((state: SaveStoreState) => state.autosaveEnabledByPdf);
    const saveStatusByPdf = useSaveStore((state: SaveStoreState) => state.saveStatusByPdf);
    const needsUserActionMap = useSaveStore((state: SaveStoreState) => state.needsUserAction) as Record<string, NeedsUserAction | undefined>;
    // Read once per mount; the list is mounted fresh each time the dialog opens.
    const docs = useMemo(() => {
        const list = saveManager.getRegisteredDocs();
        return mode === 'local' && targetDocId ? list.filter(d => d.id === targetDocId) : list;
    }, [mode, targetDocId]);

    const run = async (id: string, kind: ExportKind, saveAs = false) => {
        if (kind === 'save') await saveManager.saveDoc(id, { forcePicker: saveAs });
        else if (kind === 'flatten') await saveManager.saveDoc(id, { flatten: true });
        else if (kind === 'json') await saveManager.saveDoc(id, { download: true });
        else await saveManager.saveDoc(id, { downloadPackage: true });
    };

    if (docs.length === 0) {
        return <EmptyState compact title="No documents open" description="Open a PDF to save or export it." />;
    }

    return (
        <div className="space-y-5">
            {docs.map((doc) => {
                const isDirty = Boolean(isDirtyByPdf[doc.id]);
                const isAutosave = Boolean(autosaveEnabledByPdf[doc.id]);
                const status = saveStatusByPdf[doc.id] || 'idle';
                const needsAction = needsUserActionMap[doc.id];
                const busy = status === 'saving';

                return (
                    <section key={doc.id} className="space-y-3" aria-label={doc.name}>
                        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 p-3 shadow-elev-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <HardDrive size={16} className="shrink-0 text-text-muted" />
                                <span className="truncate font-medium" title={doc.name}>{doc.name}</span>
                                <span className={cn(
                                    'inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium',
                                    isDirty ? 'border-warning bg-warning-soft text-warning' : 'border-success bg-success-soft text-success',
                                )}>
                                    {isDirty ? 'Unsaved changes' : <><CheckCircle2 size={11} />Saved</>}
                                </span>
                            </div>
                            <Switch
                                className="shrink-0"
                                label="Autosave"
                                checked={isAutosave}
                                onChange={(next) => next ? saveManager.enableAutosave(doc.id) : saveManager.disableAutosave(doc.id)}
                            />
                        </div>

                        {needsAction && (
                            <div role="alert" className="flex items-center gap-2 rounded-lg border border-warning bg-warning-soft p-2 text-sm text-warning">
                                <AlertTriangle size={16} className="shrink-0" />
                                <span>
                                    {needsAction.reason === 'no-handle' && 'No file location yet. Use “Save as…” to pick one.'}
                                    {needsAction.reason === 'no-permission' && 'Write permission is needed. Use “Save as…” to grant it again.'}
                                    {needsAction.reason === 'error' && (needsAction.message || 'Save failed.')}
                                </span>
                            </div>
                        )}

                        <div className="grid gap-3 sm:grid-cols-2">
                            {exportOptions.map(option => (
                                <button
                                    key={option.kind}
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void run(doc.id, option.kind)}
                                    className="depth-pressable flex items-start gap-3 border border-line p-3 text-left disabled:cursor-wait disabled:opacity-60"
                                >
                                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                                        {busy && option.kind === 'save' ? <Loader2 size={18} className="animate-spin" /> : option.icon}
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block text-sm font-semibold text-text">{option.title}</span>
                                        <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{option.description}</span>
                                    </span>
                                </button>
                            ))}
                        </div>

                        <div className="flex justify-end">
                            <Button size="sm" variant="ghost" disabled={busy} leadingIcon={<FileDown size={14} />} onClick={() => void run(doc.id, 'save', true)}>
                                Save as…
                            </Button>
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
