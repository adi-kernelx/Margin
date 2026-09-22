import { X } from 'lucide-react';
import { FileTree } from './FileTree';
import { IconButton } from '../ui/IconButton';
import { cn } from '@/lib/utils';

interface SideMenuProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenFile?: (file: unknown) => void;
}

export function SideMenu({ isOpen, onClose, onOpenFile }: SideMenuProps) {
    if (!isOpen) return null;

    return (
        <aside
            className={cn(
                'absolute inset-y-0 left-0 z-panel flex w-72 flex-col border-r border-line',
                'bg-surface-1 shadow-elev-3 font-sans transition-transform duration-surface',
            )}
            aria-label="File system side menu"
        >
            <div className="flex items-center justify-between border-b border-line-soft p-3">
                <span className="font-semibold text-text">Files</span>
                <IconButton onClick={onClose} aria-label="Close file menu">
                    <X size={16} />
                </IconButton>
            </div>

            <div className="flex-1 overflow-hidden">
                <FileTree onOpenFile={(file) => onOpenFile && onOpenFile(file)} />
            </div>
        </aside>
    );
}
