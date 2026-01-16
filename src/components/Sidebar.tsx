import { useState } from 'react';
import { Toolbar } from './Toolbar';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { operationManager } from '@/lib/annotations/operation-manager';
import { saveManager } from '@/lib/saving/save-manager';
import { useGlobalModified } from '@/components/SaveButton';
import { SaveOptionsModal } from '@/components/SaveOptionsModal';

interface SidebarProps {
    replicateToolbar: boolean;
    setReplicateToolbar: (val: boolean) => void;
}

export function Sidebar({ replicateToolbar, setReplicateToolbar }: SidebarProps) {
    const { isDarkMode } = useAppStore();
    const isGlobalModified = useGlobalModified();
    const [showSaveOptions, setShowSaveOptions] = useState(false);

    if (replicateToolbar) {
        return (
            <div className={cn(
                "w-12 border-r flex flex-col items-center py-4 gap-4 z-40 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800",
            )}>
                <div className="flex flex-col gap-4 items-center">
                    <label className="flex flex-col items-center gap-2 cursor-pointer group" title="Shared Toolbar">
                        <input
                            type="checkbox"
                            className="hidden"
                            checked={replicateToolbar}
                            onChange={(e) => setReplicateToolbar(e.target.checked)}
                        />
                        <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                            replicateToolbar ? "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300" : "bg-gray-200 dark:bg-gray-800 text-gray-500"
                        )}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="8" height="18" x="3" y="3" rx="1" /><path d="M15 3v18" /></svg>
                        </div>
                    </label>
                </div>
            </div>
        )
    }

    return (
        <div
            className={cn(
                "w-20 border-r flex flex-col items-center py-4 gap-4 z-40 overflow-y-auto overflow-x-hidden",
                isDarkMode ? "bg-gray-900 text-white border-gray-800" : "bg-white text-gray-900 border-gray-200"
            )}
        >
            <Toolbar
                replicateToolbar={replicateToolbar}
                onToggleReplicate={() => setReplicateToolbar(!replicateToolbar)}
                onUndo={() => operationManager.undoGlobal()}
                onRedo={() => operationManager.redoGlobal()}
                canUndo={true} // TODO: Subscribe to state
                canRedo={true}
                onSave={() => saveManager.saveAllModified()}
                onOpenSaveOptions={() => setShowSaveOptions(true)}
                isModified={isGlobalModified}
            />

            <SaveOptionsModal
                isOpen={showSaveOptions}
                onClose={() => setShowSaveOptions(false)}
                mode="global"
            />
        </div>
    );
}
