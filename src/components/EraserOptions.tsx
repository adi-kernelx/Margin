import { useDocumentStore } from '@/hooks/useDocumentStore';
import type { EraserMode } from '@/lib/store';
import { Popover } from './ui/Popover';
import { SegmentedControl } from './ui/SegmentedControl';

interface EraserOptionsProps {
    isOpen: boolean;
    onClose: () => void;
}

const modes = [
    { value: 'stroke', label: 'Whole', description: 'Delete the complete annotation.' },
    { value: 'point', label: 'Partial', description: 'Erase only the touched portion.' },
] satisfies ReadonlyArray<{ value: EraserMode; label: string; description: string }>;

export function EraserOptions({ isOpen, onClose }: EraserOptionsProps) {
    const { annotationMode, eraserMode, setEraserMode } = useDocumentStore();
    return (
        <Popover open={isOpen && annotationMode === 'eraser'} title="Eraser options" onClose={onClose} className="left-16 top-48 w-64">
            <SegmentedControl label="Eraser mode" value={eraserMode} options={modes} onChange={setEraserMode} />
            <p className="mt-3 text-xs leading-normal text-text-muted">
                {eraserMode === 'stroke' ? 'Deletes an entire annotation in one action.' : 'Splits strokes and keeps the untouched pieces.'}
            </p>
        </Popover>
    );
}
