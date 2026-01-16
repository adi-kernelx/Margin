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

        window.addEventListener('pdf-editor:toast' as any, handleToast as any);
        return () => window.removeEventListener('pdf-editor:toast' as any, handleToast as any);
    }, []);

    // Also listen for save fallback specific events
    useEffect(() => {
        const handleSaveFallback = (e: CustomEvent<{ filename: string }>) => {
            const event = new CustomEvent('pdf-editor:toast', {
                detail: {
                    title: 'Save Fallback Active',
                    description: `Annotations downloaded as ${e.detail.filename} because in-place save was not possible. Please load this JSON file next time you open the PDF.`,
                    type: 'warning',
                    duration: 10000
                }
            });
            window.dispatchEvent(event);
        };

        window.addEventListener('pdf-editor:save-fallback' as any, handleSaveFallback as any);
        return () => window.removeEventListener('pdf-editor:save-fallback' as any, handleSaveFallback as any);
    }, []);

    if (toasts.length === 0) return null;

    return createPortal(
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
            {toasts.map(toast => (
                <div
                    key={toast.id}
                    className={cn(
                        "pointer-events-auto flex items-start gap-3 p-4 rounded-lg shadow-lg border animate-in slide-in-from-right-full transition-all",
                        toast.type === 'success' ? "bg-green-50 border-green-200 text-green-900 dark:bg-green-900/90 dark:border-green-800 dark:text-green-100" :
                            toast.type === 'error' ? "bg-red-50 border-red-200 text-red-900 dark:bg-red-900/90 dark:border-red-800 dark:text-red-100" :
                                toast.type === 'warning' ? "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-900/90 dark:border-amber-800 dark:text-amber-100" :
                                    "bg-white border-gray-200 text-gray-900 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
                    )}
                >
                    {toast.type === 'success' && <CheckCircle2 className="flex-shrink-0" size={20} />}
                    {toast.type === 'error' && <AlertCircle className="flex-shrink-0" size={20} />}
                    {toast.type === 'warning' && <AlertCircle className="flex-shrink-0" size={20} />}
                    {toast.type === 'info' && <Info className="flex-shrink-0" size={20} />}

                    <div className="flex-1">
                        <h4 className="font-semibold text-sm">{toast.title}</h4>
                        {toast.description && <p className="text-sm opacity-90">{toast.description}</p>}
                    </div>

                    <button
                        onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                        className="opacity-50 hover:opacity-100"
                    >
                        <X size={16} />
                    </button>
                </div>
            ))}
        </div>,
        document.body
    );
}

// Helper to trigger toast
export function toast(props: Omit<ToastMessage, 'id'>) {
    window.dispatchEvent(new CustomEvent('pdf-editor:toast', { detail: props }));
}
