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
        provides: 'the AI assistant and semantic search',
    },
];

const FETCH_TIMEOUT_MS = 2500;
const INTERVAL_ONLINE_MS = 5_000;
const INTERVAL_OFFLINE_MS = 30_000;

interface HealthState {
    /** One entry per service; missing keys default to 'checking'. */
    byKey: Record<ServiceKey, ServiceHealth>;
    lastCheckedAt: Record<ServiceKey, number>;
    set: (key: ServiceKey, state: ServiceHealth) => void;
}

export const useServiceHealthStore = create<HealthState>((set) => ({
    byKey: { ocr: 'checking', rag: 'checking' },
    lastCheckedAt: { ocr: 0, rag: 0 },
    set: (key, state) => set(prev => ({
        byKey: { ...prev.byKey, [key]: state },
        lastCheckedAt: { ...prev.lastCheckedAt, [key]: Date.now() },
    })),
}));

/** Fire-and-forget probe; never throws. */
async function probe(descriptor: ServiceDescriptor): Promise<ServiceHealth> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(descriptor.healthUrl, { signal: controller.signal });
        if (!response.ok) return 'offline';
        const body = await response.json().catch(() => null);
        return body && body.status === 'ok' ? 'online' : 'offline';
    } catch {
        return 'offline';
    } finally {
        window.clearTimeout(timeout);
    }
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
            const state = await probe(descriptor);
            set(descriptor.key, state);
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
