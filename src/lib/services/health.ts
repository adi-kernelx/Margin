// Service health poller.
//
// Every optional Python service exposes GET /health returning
// {"status":"ok"}. The status bar reads this to render a live dot per service
// so the user can tell at a glance whether OCR and the assistant are
// available before they attempt an action that needs them.
//
// The poll uses exponential back-off on failure so a stopped service does
// not produce a per-second console error; it settles at one probe every
// thirty seconds while offline and one every five seconds while online.

import { create } from 'zustand';
import { parseModelStatus, type ModelStatus } from '@/core/assistant/readiness';

export type ServiceKey = 'ocr' | 'rag';

export type ServiceHealth = 'online' | 'offline' | 'checking';

export interface ServiceDescriptor {
    key: ServiceKey;
    label: string;
    /** Health endpoint. Must respond within FETCH_TIMEOUT_MS or it is offline. */
    healthUrl: string;
    /** Feature the user loses when this service is offline. Rendered in the tooltip. */
    provides: string;
}

export const SERVICES: readonly ServiceDescriptor[] = [
    {
        key: 'ocr',
        label: 'OCR',
        healthUrl: 'http://localhost:8000/health',
        provides: 'text recognition on scanned pages',
    },
    {
        key: 'rag',
        label: 'Assistant',
        healthUrl: 'http://localhost:9101/health',
        provides: 'the AI assistant retrieval index',
    },
];

const FETCH_TIMEOUT_MS = 2500;
const INTERVAL_ONLINE_MS = 5_000;
const INTERVAL_OFFLINE_MS = 30_000;

interface HealthState {
    /** One entry per service; missing keys default to 'checking'. */
    byKey: Record<ServiceKey, ServiceHealth>;
    lastCheckedAt: Record<ServiceKey, number>;
    /** The assistant's language model, as reported by the RAG service's /health. */
    ragModel: ModelStatus;
    set: (key: ServiceKey, state: ServiceHealth, body?: unknown) => void;
}

export const useServiceHealthStore = create<HealthState>((set) => ({
    byKey: { ocr: 'checking', rag: 'checking' },
    lastCheckedAt: { ocr: 0, rag: 0 },
    ragModel: { state: 'unknown', name: null },
    set: (key, state, body) => set(prev => ({
        byKey: { ...prev.byKey, [key]: state },
        lastCheckedAt: { ...prev.lastCheckedAt, [key]: Date.now() },
        ...(key === 'rag' ? { ragModel: state === 'online' ? parseModelStatus(body) : { state: 'unknown', name: null } } : {}),
    })),
}));

/** Fire-and-forget probe; never throws. */
async function probe(descriptor: ServiceDescriptor): Promise<{ state: ServiceHealth; body?: unknown }> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(descriptor.healthUrl, { signal: controller.signal });
        if (!response.ok) return { state: 'offline' };
        const body = await response.json().catch(() => null);
        return body && body.status === 'ok' ? { state: 'online', body } : { state: 'offline' };
    } catch {
        return { state: 'offline' };
    } finally {
        window.clearTimeout(timeout);
    }
}

/** One immediate probe, used by Settings' "Test connection". */
export async function checkServiceNow(key: ServiceKey): Promise<ServiceHealth> {
    const descriptor = SERVICES.find(service => service.key === key);
    if (!descriptor) return 'offline';
    const { set } = useServiceHealthStore.getState();
    set(key, 'checking');
    const { state, body } = await probe(descriptor);
    set(key, state, body);
    return state;
}

let started = false;
let timers: number[] = [];

/**
 * Starts polling once per browser tab; safe to call multiple times. Cleans up
 * on `stopServiceHealthPolling` (used by tests).
 */
export function startServiceHealthPolling(): void {
    if (started) return;
    started = true;

    const set = useServiceHealthStore.getState().set;

    for (const descriptor of SERVICES) {
        const run = async () => {
            const { state, body } = await probe(descriptor);
            set(descriptor.key, state, body);
            const next = state === 'online' ? INTERVAL_ONLINE_MS : INTERVAL_OFFLINE_MS;
            timers.push(window.setTimeout(run, next));
        };
        void run();
    }
}

export function stopServiceHealthPolling(): void {
    for (const timer of timers) window.clearTimeout(timer);
    timers = [];
    started = false;
}
