import type { HighlightAnnotation, StrokeAnnotation } from '@/core/annotations/models';

type InkAnnotation = StrokeAnnotation | HighlightAnnotation;
let worker: Worker | null = null;
let requestId = 0;

export function supportsOffscreenInk(): boolean {
    return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

function getWorker(): Worker {
    worker ||= new Worker(new URL('./ink-render-worker.ts', import.meta.url), { type: 'module' });
    return worker;
}

export function renderInkOffscreen(
    annotations: InkAnnotation[],
    width: number,
    height: number,
    dpr: number,
): Promise<ImageBitmap> {
    return new Promise((resolve, reject) => {
        const activeWorker = getWorker();
        const activeRequest = ++requestId;
        const onMessage = (event: MessageEvent) => {
            if (event.data.requestId !== activeRequest) return;
            activeWorker.removeEventListener('message', onMessage);
            if (event.data.type === 'ink-rendered') resolve(event.data.bitmap);
            else reject(new Error(event.data.error));
        };
        activeWorker.addEventListener('message', onMessage);
        activeWorker.postMessage({
            type: 'render-ink',
            requestId: activeRequest,
            annotations,
            width,
            height,
            dpr,
        });
    });
}
