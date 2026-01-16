import { FileTree } from './FileTree';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { X } from 'lucide-react';

interface SideMenuProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenFile?: (file: any) => void;
}

export function SideMenu({ isOpen, onClose, onOpenFile }: SideMenuProps) {
    const { isDarkMode } = useAppStore();

    if (!isOpen) return null;

    return (
        <div className={cn(
            "absolute top-0 left-0 h-full w-72 border-r shadow-2xl z-50 flex flex-col transition-transform duration-200 ease-in-out font-sans",
            isDarkMode ? "bg-gray-900 border-gray-800" : "bg-gray-50 border-gray-200"
        )}>

            <div
                className="
    p-3 flex items-center justify-between
    border-b border-gray-100
    dark:border-gray-800
  "
            >
                <span className="font-semibold text-Black dark:text-gray-200">
                    Files
                </span>

                <button
                    onClick={onClose}
                    className="
      p-1.5 rounded-md transition-colors
      text-black
      hover:bg-black hover:text-white
      dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300
    "
                >
                    <X size={16} />
                </button>
            </div>




            <div className="flex-1 overflow-hidden">
                <FileTree onOpenFile={(file) => onOpenFile && onOpenFile(file)} />
            </div>
        </div>
    );
}
