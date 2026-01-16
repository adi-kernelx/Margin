import type { StrokePoint } from '../annotations/models';

// Worker instance (singleton)
let worker: Worker | null = null;

function getWorker(): Worker {
    if (!worker) {
        worker = new Worker(
            new URL('./stroke-worker.ts', import.meta.url),
            { type: 'module' }
        );
    }
    return worker;
}

export interface ProcessStrokeOptions {
    points: StrokePoint[];
    tension?: number;
    epsilon?: number;
}

export interface ProcessedStrokeResult {
    originalCount: number;
    compressedCount: number;
    points: StrokePoint[];
}

/**
 * Process stroke asynchronously in a WebWorker
 * Returns a promise that resolves with the processed points
 */
export function processStrokeAsync(
    options: ProcessStrokeOptions
): Promise<ProcessedStrokeResult> {
    return new Promise((resolve, reject) => {
        const w = getWorker();
        
        const handler = (e: MessageEvent) => {
            if (e.data.type === 'stroke-processed') {
                w.removeEventListener('message', handler);
                resolve({
                    originalCount: e.data.originalCount,
                    compressedCount: e.data.compressedCount,
                    points: e.data.points,
                });
            } else if (e.data.type === 'error') {
                w.removeEventListener('message', handler);
                reject(new Error(e.data.error));
            }
        };

        w.addEventListener('message', handler);
        
        w.postMessage({
            type: 'process-stroke',
            points: options.points,
            tension: options.tension ?? 0.5,
            epsilon: options.epsilon ?? 0.001,
        });
    });
}

/**
 * Clean up worker (call when done)
 */
export function cleanupWorker(): void {
    if (worker) {
        worker.terminate();
        worker = null;
    }
}


