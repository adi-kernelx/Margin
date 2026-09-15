import { Square, Type } from 'lucide-react';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import type { SelectionMode } from '@/lib/store';
import { Popover } from './ui/Popover';

interface SelectOptionsProps {
    isOpen: boolean;
    onClose: () => void;
}

const modes = [
    { value: 'text', label: 'PDF text', description: 'Select and copy the document text.', icon: Type },
    { value: 'annotations', label: 'Images and shapes', description: 'Move and resize visual annotations.', icon: Square },
    { value: 'text-annotation', label: 'Text boxes', description: 'Move and edit added text boxes.', icon: Type },
] satisfies ReadonlyArray<{ value: SelectionMode; label: string; description: string; icon: typeof Type }>;

export function SelectOptions({ isOpen, onClose }: SelectOptionsProps) {
    const { annotationMode, selectionMode, setSelectionMode } = useDocumentStore();
    return (
        <Popover open={isOpen && annotationMode === 'select'} title="Selection mode" onClose={onClose} className="left-16 top-16 w-72">
            <div className="space-y-1" role="radiogroup" aria-label="Selection mode">
                {modes.map((mode) => {
                    const Icon = mode.icon;
                    const selected = selectionMode === mode.value;
                    return (
                        <button
                            key={mode.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            className="flex w-full items-start gap-3 rounded-lg border border-transparent p-2 text-left text-text-soft transition-colors duration-state hover:bg-surface-4 aria-checked:border-accent aria-checked:bg-accent-soft aria-checked:text-accent"
                            onClick={() => {
                                setSelectionMode(mode.value);
                                onClose();
                            }}
                        >
                            <Icon size={17} className="mt-0.5 shrink-0" />
                            <span><span className="block text-sm font-semibold">{mode.label}</span><span className="block text-xs text-text-muted">{mode.description}</span></span>
                        </button>
                    );
                })}
            </div>
        </Popover>
    );
}
