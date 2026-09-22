import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ToastMessage {
    id: string;
    title: string;
    description?: string;
    type: 'success' | 'error' | 'info' | 'warning';
    duration?: number;
}

const surfaceByType: Record<ToastMessage['type'], string> = {
    // Colour and border together — meaning never rides on colour alone, so
    // colour-blind users still see a hierarchy of borders and the icon shape.
    success: 'bg-success-soft border-success text-success',
    error:   'bg-danger-soft  border-danger  text-danger',
    warning: 'bg-warning-soft border-warning text-warning',
    info:    'bg-surface-2    border-line    text-text',
};

export function ToastContainer() {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    useEffect(() => {
        const handleToast = (e: CustomEvent<Omit<ToastMessage, 'id'>>) => {
            const id = crypto.randomUUID();
            const newToast = { ...e.detail, id };
            setToasts(prev => [...prev, newToast]);

            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
            }, e.detail.duration || 5000);
        };

        window.addEventListener('pdf-editor:toast' as never, handleToast as never);
        return () => window.removeEventListener('pdf-editor:toast' as never, handleToast as never);
    }, []);

    useEffect(() => {
        const handleSaveFallback = (e: CustomEvent<{ filename: string }>) => {
            const event = new CustomEvent('pdf-editor:toast', {
                detail: {
                    title: 'Save Fallback Active',
                    description: `Annotations downloaded as ${e.detail.filename} because in-place save was not possible. Please load this JSON file next time you open the PDF.`,
                    type: 'warning',
                    duration: 10000,
                },
            });
            window.dispatchEvent(event);
        };

        window.addEventListener('pdf-editor:save-fallback' as never, handleSaveFallback as never);
        return () => window.removeEventListener('pdf-editor:save-fallback' as never, handleSaveFallback as never);
    }, []);

    if (toasts.length === 0) return null;

    return createPortal(
        <div className="fixed bottom-4 right-4 z-popover flex flex-col gap-2 max-w-sm w-full pointer-events-none">
            {toasts.map(toast => (
                <div
                    key={toast.id}
                    role="status"
                    className={cn(
                        'pointer-events-auto flex items-start gap-3 p-4 rounded-lg border shadow-elev-3 transition-all',
                        'animate-in slide-in-from-right-full',
                        surfaceByType[toast.type],
                    )}
                >
                    {toast.type === 'success' && <CheckCircle2 className="flex-shrink-0" size={20} />}
                    {toast.type === 'error'   && <AlertCircle className="flex-shrink-0" size={20} />}
                    {toast.type === 'warning' && <AlertCircle className="flex-shrink-0" size={20} />}
                    {toast.type === 'info'    && <Info className="flex-shrink-0" size={20} />}

                    <div className="flex-1">
                        <h4 className="font-semibold text-sm">{toast.title}</h4>
                        {toast.description && <p className="text-sm opacity-90">{toast.description}</p>}
                    </div>

                    <button
                        onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                        className="opacity-60 hover:opacity-100 focus-visible:opacity-100"
                        aria-label="Dismiss"
                    >
                        <X size={16} />
                    </button>
                </div>
            ))}
        </div>,
        document.body,
    );
}

/** Convenience emitter for use from anywhere in the tree. */
export function toast(props: Omit<ToastMessage, 'id'>) {
    window.dispatchEvent(new CustomEvent('pdf-editor:toast', { detail: props }));
}
