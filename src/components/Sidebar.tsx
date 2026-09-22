import { useState } from 'react';
import { Columns } from 'lucide-react';
import { Toolbar } from './Toolbar';
import { operationManager } from '@/lib/annotations/operation-manager';
import { saveManager } from '@/lib/saving/save-manager';
import { useGlobalModified } from '@/components/SaveButton';
import { SaveOptionsModal } from '@/components/SaveOptionsModal';
import { cn } from '@/lib/utils';

interface SidebarProps {
    replicateToolbar: boolean;
    setReplicateToolbar: (val: boolean) => void;
}

export function Sidebar({ replicateToolbar, setReplicateToolbar }: SidebarProps) {
    const isGlobalModified = useGlobalModified();
    const [showSaveOptions, setShowSaveOptions] = useState(false);

    if (replicateToolbar) {
        // Rail with a single toggle: switch back to a shared toolbar. Sits at
        // elevation 1 as chrome, same as the header.
        return (
            <div
                className={cn(
                    'flex w-12 flex-shrink-0 flex-col items-center gap-4 border-r border-line',
                    'bg-surface-1 py-4 shadow-elev-1',
                )}
            >
                <label className="group flex cursor-pointer flex-col items-center gap-2" title="Switch back to a shared toolbar">
                    <input
                        type="checkbox"
                        className="sr-only"
                        checked={replicateToolbar}
                        onChange={event => setReplicateToolbar(event.target.checked)}
                    />
                    <div
                        aria-hidden
                        className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-state',
                            'bg-accent-soft text-accent',
                        )}
                    >
                        <Columns size={18} />
                    </div>
                </label>
            </div>
        );
    }

    return (
        <>
            <Toolbar
                replicateToolbar={replicateToolbar}
                onToggleReplicate={() => setReplicateToolbar(!replicateToolbar)}
                onUndo={() => operationManager.undoGlobal()}
                onRedo={() => operationManager.redoGlobal()}
                canUndo={true}
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
        </>
    );
}
