import { FileCheck, FolderOpen } from 'lucide-react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';

interface PermissionPromptProps {
    isOpen: boolean;
    fileName: string;
    onAllow: () => void;
    onDeny: () => void;
}

export function PermissionPrompt({ isOpen, fileName, onAllow, onDeny }: PermissionPromptProps) {
    return (
        <Dialog
            open={isOpen}
            title="Enable in-place saves"
            onClose={onDeny}
            footer={
                <>
                    <Button variant="ghost" onClick={onDeny}>Skip</Button>
                    <Button variant="primary" onClick={onAllow} leadingIcon={<FolderOpen size={16} />}>Allow</Button>
                </>
            }
        >
            <div className="flex items-start gap-3">
                <div className="rounded-lg bg-accent-soft p-2.5 text-accent" aria-hidden>
                    <FileCheck size={22} />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text-muted" title={fileName}>{fileName}</p>
                    <p className="mt-2 text-sm text-text-soft">
                        Allow Margin to save changes directly to the original file? This enables
                        autosave and prevents data loss.
                    </p>
                </div>
            </div>
        </Dialog>
    );
}
