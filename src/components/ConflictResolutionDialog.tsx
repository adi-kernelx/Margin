import { useSaveStore } from '@/lib/saving/save-manager';
import type { SaveStoreState } from '@/lib/saving/save-manager';
import type { ConflictInfo } from '@/lib/saving/api-types';
import { X, AlertTriangle, Download, Copy, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConflictResolutionDialogProps {
    conflict: ConflictInfo;
    onReloadLatest: () => void;
    onOverwrite: () => void;
    onSaveCopy: () => void;
    onCancel: () => void;
}

export function ConflictResolutionDialog({
    conflict,
    onReloadLatest,
    onOverwrite,
    onSaveCopy,
    onCancel
}: ConflictResolutionDialogProps) {
    const serverDate = conflict.serverSavedAt
        ? new Date(conflict.serverSavedAt).toLocaleString()
        : 'Unknown time';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6 m-4 border dark:border-gray-700">
                {/* Header */}
                <div className="flex items-start gap-4 mb-6">
                    <div className="p-3 bg-amber-100 dark:bg-amber-900/30 rounded-full">
                        <AlertTriangle className="text-amber-600 dark:text-amber-400" size={24} />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                            Conflict Detected
                        </h2>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            This file was changed by someone else at <strong>{serverDate}</strong>.
                            Your local changes are based on an older version.
                        </p>
                    </div>
                    <button
                        onClick={onCancel}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                    >
                        <X size={20} className="text-gray-500" />
                    </button>
                </div>

                {/* Info Box */}
                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 mb-6 text-sm">
                    <div className="flex justify-between mb-2">
                        <span className="text-gray-500 dark:text-gray-400">Server version:</span>
                        <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                            {conflict.serverHash.slice(0, 12)}...
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Your version:</span>
                        <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                            {conflict.localHash.slice(0, 12)}...
                        </span>
                    </div>
                </div>

                {/* Actions */}
                <div className="space-y-3">
                    {/* Reload Latest */}
                    <button
                        onClick={onReloadLatest}
                        className={cn(
                            "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors",
                            "bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30",
                            "border border-blue-200 dark:border-blue-800"
                        )}
                    >
                        <RefreshCw className="text-blue-600 dark:text-blue-400" size={20} />
                        <div>
                            <div className="font-medium text-blue-700 dark:text-blue-300">
                                Reload Latest
                            </div>
                            <div className="text-xs text-blue-600/80 dark:text-blue-400/80">
                                Discard your local changes and load the server version
                            </div>
                        </div>
                    </button>

                    {/* Overwrite */}
                    <button
                        onClick={onOverwrite}
                        className={cn(
                            "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors",
                            "bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30",
                            "border border-amber-200 dark:border-amber-800"
                        )}
                    >
                        <Download className="text-amber-600 dark:text-amber-400" size={20} />
                        <div>
                            <div className="font-medium text-amber-700 dark:text-amber-300">
                                Overwrite Anyway
                            </div>
                            <div className="text-xs text-amber-600/80 dark:text-amber-400/80">
                                Replace server version with your local changes
                            </div>
                        </div>
                    </button>

                    {/* Save Copy */}
                    <button
                        onClick={onSaveCopy}
                        className={cn(
                            "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors",
                            "bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30",
                            "border border-green-200 dark:border-green-800"
                        )}
                    >
                        <Copy className="text-green-600 dark:text-green-400" size={20} />
                        <div>
                            <div className="font-medium text-green-700 dark:text-green-300">
                                Save as Copy
                            </div>
                            <div className="text-xs text-green-600/80 dark:text-green-400/80">
                                Create a new file with your changes, keep both versions
                            </div>
                        </div>
                    </button>
                </div>

                {/* Cancel hint */}
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-4">
                    Press Escape or click outside to close. Autosave is paused until resolved.
                </p>
            </div>
        </div>
    );
}

/**
 * Wrapper component that reads conflict state from store
 */
export function ConflictDialogContainer({
    docId,
    onReloadLatest,
    onOverwrite,
    onSaveCopy
}: {
    docId: string;
    onReloadLatest: (conflict: ConflictInfo) => void;
    onOverwrite: (conflict: ConflictInfo) => void;
    onSaveCopy: (conflict: ConflictInfo) => void;
}) {
    const conflict = useSaveStore((state: SaveStoreState) => state.conflictByPdf[docId]);
    const setConflict = useSaveStore((state: SaveStoreState) => state.setConflict);

    if (!conflict) return null;

    return (
        <ConflictResolutionDialog
            conflict={conflict}
            onReloadLatest={() => {
                onReloadLatest(conflict);
                setConflict(docId, null);
            }}
            onOverwrite={() => {
                onOverwrite(conflict);
                setConflict(docId, null);
            }}
            onSaveCopy={() => {
                onSaveCopy(conflict);
                setConflict(docId, null);
            }}
            onCancel={() => {
                // Just close the dialog, keep conflict state for next save attempt
                setConflict(docId, null);
            }}
        />
    );
}
