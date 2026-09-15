import type { StrokePoint } from '@/core/annotations/models';
import { processStroke } from '@/core/ink/stroke-processing';

interface ProcessStrokeMessage {
    type: 'process-stroke';
    requestId: number;
    points: StrokePoint[];
    width: number;
    height: number;
    epsilonPx: number;
}

self.onmessage = (event: MessageEvent<ProcessStrokeMessage>) => {
    if (event.data.type !== 'process-stroke') return;
    const { requestId, points, width, height, epsilonPx } = event.data;
    try {
        self.postMessage({
            type: 'stroke-processed',
            requestId,
            ...processStroke(points, width, height, epsilonPx),
        });
    } catch (error) {
        self.postMessage({
            type: 'error',
            requestId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
