import { saveManager, useSaveStore } from '@/lib/saving/save-manager';
import type { SaveStoreState } from '@/lib/saving/save-manager';
import { cn } from '@/lib/utils';
import { X, Save, FileDown, ToggleLeft, ToggleRight, Loader2, CheckCircle2, AlertCircle, AlertTriangle, Cloud, HardDrive, Package } from 'lucide-react';
import { useEffect, useState } from 'react';

interface SaveOptionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    mode: 'global' | 'local';
    docId?: string; // If local, which doc
}

export function SaveOptionsModal({ isOpen, onClose, mode, docId }: SaveOptionsModalProps) {
    if (!isOpen) return null;

    const isDirtyByPdf = useSaveStore((state: SaveStoreState) => state.isDirtyByPdf);
    const autosaveEnabledByPdf = useSaveStore((state: SaveStoreState) => state.autosaveEnabledByPdf);
    const saveStatusByPdf = useSaveStore((state: SaveStoreState) => state.saveStatusByPdf);
    const needsUserActionMap = useSaveStore((state: SaveStoreState) => state.needsUserAction);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6 m-4 border dark:border-gray-700" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-semibold dark:text-white">
                        {mode === 'global' ? 'Save Options (All Files)' : 'Save Options'}
                    </h2>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                        <X size={20} className="text-gray-500" />
                    </button>
                </div>

                <div className="space-y-4">
                    <DocsList
                        mode={mode}
                        targetDocId={docId}
                        isDirtyByPdf={isDirtyByPdf}
                        autosaveEnabledByPdf={autosaveEnabledByPdf}
                        saveStatusByPdf={saveStatusByPdf}
                        needsUserActionMap={needsUserActionMap}
                    />
                </div>
            </div>
        </div>
    );
}

interface DocsListProps {
    mode: 'global' | 'local';
    targetDocId?: string;
    isDirtyByPdf: Record<string, boolean>;
    autosaveEnabledByPdf: Record<string, boolean>;
    saveStatusByPdf: Record<string, string>;
    needsUserActionMap: Record<string, any>;
}

function DocsList({ mode, targetDocId, isDirtyByPdf, autosaveEnabledByPdf, saveStatusByPdf, needsUserActionMap }: DocsListProps) {
    const [docs, setDocs] = useState<{ id: string; name: string; kind?: 'local' | 'cloud' }[]>([]);

    useEffect(() => {
        const list = saveManager.getRegisteredDocs();
        if (mode === 'local' && targetDocId) {
            setDocs(list.filter(d => d.id === targetDocId));
        } else {
            setDocs(list);
        }
    }, [mode, targetDocId]);

    const handleToggleAutosave = async (id: string, current: boolean) => {
        console.log('[SaveOptionsModal] Toggling autosave for', id, 'Current:', current);
        if (current) {
            saveManager.disableAutosave(id);
        } else {
            saveManager.enableAutosave(id);
        }
    };

    const handleSave = async (id: string, saveAs: boolean) => {
        await saveManager.saveDoc(id, { forcePicker: saveAs });
    };

    const handleDownloadPackage = async (id: string) => {
        await saveManager.saveDoc(id, { downloadPackage: true });
    };

    const handleFlatten = async (id: string) => {
        await saveManager.saveDoc(id, { flatten: true });
    };

    const handleJSON = async (id: string) => {
        await saveManager.saveDoc(id, { download: true });
    };

    if (docs.length === 0) return <div className="text-gray-500 py-4 text-center">No documents found.</div>;

    return (
        <div className="flex flex-col gap-3 max-h-80 overflow-y-auto">
            {docs.map((doc) => {
                const isDirty = isDirtyByPdf[doc.id];
                const isAutosave = autosaveEnabledByPdf[doc.id];
                const status = saveStatusByPdf[doc.id] || 'idle';
                const needsAction = needsUserActionMap[doc.id];
                const isCloud = doc.kind === 'cloud';

                return (
                    <div key={doc.id} className="flex flex-col gap-2 p-3 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2 truncate max-w-[200px]">
                                {/* File Type Icon */}
                                {isCloud ? (
                                    <Cloud size={16} className="text-blue-500 flex-shrink-0" />
                                ) : (
                                    <HardDrive size={16} className="text-gray-500 flex-shrink-0" />
                                )}

                                {/* File Name with Type Badge */}
                                <span className="font-medium dark:text-gray-200 truncate" title={doc.name}>
                                    {doc.name}
                                </span>
                                <span className={cn(
                                    "text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0",
                                    isCloud
                                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                                        : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                                )}>
                                    {isCloud ? 'Cloud' : 'Local'}
                                </span>

                                {isDirty && <span className="text-xs text-amber-500 font-bold">●</span>}
                            </div>

                            {/* Autosave Toggle */}
                            <button
                                onClick={() => handleToggleAutosave(doc.id, !!isAutosave)}
                                className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 transition-colors"
                            >
                                {isAutosave ? <ToggleRight className="text-blue-600" size={24} strokeWidth={2.5} /> : <ToggleLeft size={24} />}
                                <span>Autosave</span>
                            </button>
                        </div>

                        {/* Needs Action Warning */}
                        {needsAction && (
                            <div className="flex items-center gap-2 p-2 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-sm">
                                <AlertTriangle size={16} />
                                <span>
                                    {needsAction.reason === 'no-handle' && 'No file selected. Click Save As to pick a location.'}
                                    {needsAction.reason === 'no-permission' && 'Write permission needed. Click Save As to re-grant.'}
                                    {needsAction.reason === 'error' && (needsAction.message || 'Save failed.')}
                                </span>
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2 mt-2">
                            {/* 1. Quick Save */}
                            <button
                                onClick={() => handleSave(doc.id, false)}
                                disabled={status === 'saving'}
                                className={cn(
                                    "flex-1 min-w-[100px] flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                                    status === 'done' ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                                        status === 'error' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                                            "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                                )}
                            >
                                {status === 'saving' ? <Loader2 className="animate-spin" size={16} /> :
                                    status === 'done' ? <CheckCircle2 size={16} /> :
                                        status === 'error' ? <AlertCircle size={16} /> :
                                            <Save size={16} />}
                                {status === 'saving' ? 'Saving...' : status === 'done' ? 'Saved' : status === 'error' ? 'Retry' : 'Save'}
                            </button>

                            {/* 2. Package Download */}
                            <button
                                onClick={() => handleDownloadPackage(doc.id)}
                                disabled={status === 'saving'}
                                className="flex-1 min-w-[120px] flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 transition-colors"
                                title="Download Original PDF + Flattened PDF + JSON as a package"
                            >
                                <Package size={16} />
                                Package
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2 mt-2">
                            {/* 3. JSON Only */}
                            <button
                                onClick={() => handleJSON(doc.id)}
                                disabled={status === 'saving'}
                                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 transition-colors"
                            >
                                <FileDown size={14} />
                                JSON
                            </button>

                            {/* 4. Flatten PDF Only */}
                            <button
                                onClick={() => handleFlatten(doc.id)}
                                disabled={status === 'saving'}
                                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 transition-colors"
                            >
                                <FileDown size={14} />
                                Flatten PDF
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
