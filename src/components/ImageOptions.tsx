import { useRef } from 'react';
import { Upload } from 'lucide-react';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { Button } from './ui/Button';
import { Popover } from './ui/Popover';

declare global {
    interface Window {
        __handleImageFileUpload?: (file: File) => void;
    }
}

interface ImageOptionsProps {
    isOpen: boolean;
    onClose: () => void;
    onImageSelect: (file: File) => void;
}

export function ImageOptions({ isOpen, onClose, onImageSelect }: ImageOptionsProps) {
    const { annotationMode } = useDocumentStore();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file?.type.startsWith('image/')) return;
        (window.__handleImageFileUpload ?? onImageSelect)(file);
        event.target.value = '';
        onClose();
    };

    return (
        <Popover open={isOpen && annotationMode === 'image'} title="Image options" onClose={onClose} className="left-16 top-24 w-64">
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" aria-label="Upload image" />
            <Button className="w-full" leadingIcon={<Upload size={16} />} onClick={() => fileInputRef.current?.click()}>Upload image</Button>
            <p className="mt-3 text-center text-xs leading-normal text-text-muted">You can also paste an image, then click the PDF to place it.</p>
        </Popover>
    );
}
