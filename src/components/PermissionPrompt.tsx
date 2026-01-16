import { FileCheck, FolderOpen } from 'lucide-react';

interface PermissionPromptProps {
    isOpen: boolean;
    fileName: string;
    onAllow: () => void;
    onDeny: () => void;
}

export function PermissionPrompt({ isOpen, fileName, onAllow, onDeny }: PermissionPromptProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 m-4 border dark:border-gray-700 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
                        <FileCheck className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold dark:text-white">Enable In-Place Saves?</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-[280px]">{fileName}</p>
                    </div>
                </div>

                <p className="text-gray-600 dark:text-gray-300 text-sm mb-6">
                    Allow this app to save changes directly to the original file? This enables autosave and prevents data loss.
                </p>

                <div className="flex gap-3">
                    <button
                        onClick={onDeny}
                        className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
                    >
                        Skip
                    </button>
                    <button
                        onClick={onAllow}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2"
                    >
                        <FolderOpen size={18} />
                        Allow
                    </button>
                </div>
            </div>
        </div>
    );
}
