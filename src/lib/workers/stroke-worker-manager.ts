import type { CubicBezierSegment, StrokePoint } from '../annotations/models';

// Worker instance (singleton)
let worker: Worker | null = null;
let nextRequestId = 0;

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
    width: number;
    height: number;
    epsilonPx?: number;
}

export interface ProcessedStrokeResult {
    sourcePointCount: number;
    storedCoordinateCount: number;
    compressionRatio: number;
    points: StrokePoint[];
    beziers: CubicBezierSegment[];
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
        const requestId = ++nextRequestId;
        
        const handler = (e: MessageEvent) => {
            if (e.data.requestId !== requestId) return;
            if (e.data.type === 'stroke-processed') {
                w.removeEventListener('message', handler);
                resolve({
                    sourcePointCount: e.data.sourcePointCount,
                    storedCoordinateCount: e.data.storedCoordinateCount,
                    compressionRatio: e.data.compressionRatio,
                    points: e.data.points,
                    beziers: e.data.beziers,
                });
            } else if (e.data.type === 'error') {
                w.removeEventListener('message', handler);
                reject(new Error(e.data.error));
            }
        };

        w.addEventListener('message', handler);
        
        w.postMessage({
            type: 'process-stroke',
            requestId,
            points: options.points,
            width: options.width,
            height: options.height,
            epsilonPx: options.epsilonPx ?? 0.75,
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


