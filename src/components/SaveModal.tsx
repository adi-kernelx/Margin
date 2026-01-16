import { useState } from 'react';
import { X, Save, Loader2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SaveModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    onSaveAs: (filename: string) => void;
    fileName: string;
    autosaveEnabled: boolean;
    onToggleAutosave: () => void;
    isDirty: boolean; // Add isDirty to show status
}

export function SaveModal({ isOpen, onClose, onSave, onSaveAs, fileName, autosaveEnabled, onToggleAutosave, isDirty }: SaveModalProps) {
    const [saving, setSaving] = useState(false);
    const [newFileName, setNewFileName] = useState(fileName);
    const [mode, setMode] = useState<'save' | 'save-as'>('save');

    if (!isOpen) return null;

    const handleSaveAction = async () => {
        setSaving(true);
        try {
            if (mode === 'save') {
                await onSave();
            } else {
                await onSaveAs(newFileName);
            }
            onClose();
        } catch (error) {
            console.error('Save failed:', error);
            alert('Save failed. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 w-full max-w-md">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        Save Options
                    </h2>
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="space-y-4 mb-6">
                    {/* Status Indicator */}
                    <div className={cn(
                        "p-3 rounded-lg border flex items-center gap-3",
                        isDirty
                            ? "bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-700"
                            : "bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-700"
                    )}>
                        <div className={cn(
                            "w-2.5 h-2.5 rounded-full",
                            isDirty ? "bg-amber-500" : "bg-green-500"
                        )} />
                        <div>
                            <div className={cn(
                                "font-medium",
                                isDirty ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400"
                            )}>
                                {isDirty ? "Unsaved Changes" : "All Changes Saved"}
                            </div>
                        </div>
                    </div>

                    {/* Autosave Toggle */}
                    <div
                        onClick={onToggleAutosave}
                        className={cn(
                            "flex items-center justify-between p-3 border-2 rounded-lg cursor-pointer transition-colors",
                            autosaveEnabled
                                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                        )}
                    >
                        <div className="flex items-center gap-3">
                            <Clock size={20} className={autosaveEnabled ? "text-blue-600 dark:text-blue-400" : "text-gray-500"} />
                            <div>
                                <div className="font-medium text-gray-900 dark:text-white">Autosave (3 min)</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                    {autosaveEnabled ? "Enabled" : "Disabled"}
                                </div>
                            </div>
                        </div>
                        <div className={cn(
                            "w-12 h-6 rounded-full relative transition-colors",
                            autosaveEnabled ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"
                        )}>
                            <div className={cn(
                                "absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
                                autosaveEnabled ? "left-7" : "left-1"
                            )} />
                        </div>
                    </div>

                    {/* Save Mode Selection */}
                    <div className="flex gap-2">
                        <button
                            onClick={() => setMode('save')}
                            className={cn(
                                "flex-1 p-3 rounded-lg border-2 text-center transition-colors",
                                mode === 'save'
                                    ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                                    : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                            )}
                        >
                            Quick Save
                        </button>
                        <button
                            onClick={() => setMode('save-as')}
                            className={cn(
                                "flex-1 p-3 rounded-lg border-2 text-center transition-colors",
                                mode === 'save-as'
                                    ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                                    : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                            )}
                        >
                            Save As...
                        </button>
                    </div>

                    {/* Filename Input for Save As */}
                    {mode === 'save-as' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                File Name
                            </label>
                            <input
                                type="text"
                                value={newFileName}
                                onChange={(e) => setNewFileName(e.target.value)}
                                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="document.pdf"
                            />
                        </div>
                    )}
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className={cn(
                            "flex-1 px-4 py-2 rounded-lg font-medium transition-colors",
                            "bg-gray-200 text-gray-700 hover:bg-gray-300",
                            "dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600",
                            saving && "opacity-50 cursor-not-allowed"
                        )}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSaveAction}
                        disabled={saving}
                        className={cn(
                            "flex-1 px-4 py-2 rounded-lg font-medium transition-colors",
                            "bg-blue-600 text-white hover:bg-blue-700",
                            "flex items-center justify-center gap-2",
                            saving && "opacity-50 cursor-not-allowed"
                        )}
                    >
                        {saving ? (
                            <>
                                <Loader2 size={20} className="animate-spin" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <Save size={20} />
                                {mode === 'save' ? 'Save' : 'Save Copy'}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}


