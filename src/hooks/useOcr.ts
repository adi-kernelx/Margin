
import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/cloud-service';
import { useAuthStore } from '../lib/auth-store';

export interface OcrState {
    status: 'not_started' | 'running' | 'complete' | 'failed';
    pagesCompleted: number;
    totalPages: number;
}

export function useOcr(docId: string | null) {
    const [ocrState, setOcrState] = useState<OcrState>({
        status: 'not_started',
        pagesCompleted: 0,
        totalPages: 0
    });
    const { user } = useAuthStore();
    const pollRef = useRef<NodeJS.Timeout | null>(null);

    // Start OCR on mount / docId change
    useEffect(() => {
        if (!docId || !user) {
            setOcrState({ status: 'not_started', pagesCompleted: 0, totalPages: 0 });
            return;
        }

        let isMounted = true;

        const startOcr = async () => {
            try {
                const token = await user.getIdToken();
                console.log(`[useOcr] Starting OCR for ${docId}`);

                const res = await api.post(`/docs/${docId}/ocr/start`, {}, {
                    headers: { Authorization: `Bearer ${token}` }
                });

                if (isMounted && res.data?.job) {
                    setOcrState(() => ({
                        status: res.data.status === 'already_complete' ? 'complete' : 'running',
                        pagesCompleted: res.data.job.pagesCompleted,
                        totalPages: res.data.job.totalPages
                    }));
                }
            } catch (err) {
                console.error('[useOcr] Failed to start OCR:', err);
            }
        };

        startOcr();

        return () => {
            isMounted = false;
        };
    }, [docId, user]);

    // Poll status
    useEffect(() => {
        // Stop polling if complete or no docId
        if (!docId || !user || ocrState.status === 'complete' || ocrState.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            return;
        }

        const poll = async () => {
            try {
                const token = await user.getIdToken();
                const res = await api.get(`/docs/${docId}/ocr/status`, {
                    headers: { Authorization: `Bearer ${token}` }
                });

                setOcrState({
                    status: res.data.status,
                    pagesCompleted: res.data.pagesCompleted,
                    totalPages: res.data.totalPages
                });

                if (res.data.status === 'complete' || res.data.status === 'failed') {
                    if (pollRef.current) clearInterval(pollRef.current);
                }

            } catch (err) {
                console.error('[useOcr] Polling failed:', err);
            }
        };

        // Poll every 3 seconds
        pollRef.current = setInterval(poll, 3000);

        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [docId, user, ocrState.status]);

    return ocrState;
}
