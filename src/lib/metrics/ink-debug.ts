import type { StrokeAnnotation } from '@/core/annotations/models';
import { PencilTool } from '@/lib/tools/pencil-tool';
import { renderInkOffscreen, supportsOffscreenInk } from '@/lib/workers/ink-render-worker-manager';

export interface InkBenchmarkResult {
    supportsOffscreen: boolean;
    p95HandlerDrawMs: number;
    rawPointCount: number;
    storedPointCount: number;
    bezierSegmentCount: number;
    compressionRatio: number;
    nonTransparentPixels: number;
}

export async function runInkBenchmark(): Promise<InkBenchmarkResult> {
    const width = 1200;
    const height = 1600;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable');

    let complete: ((annotation: StrokeAnnotation) => void) | undefined;
    const completed = new Promise<StrokeAnnotation>(resolve => { complete = resolve; });
    const tool = new PencilTool(width, height, '#111111', 2, annotation => complete?.(annotation));
    tool.onPointerDown({ id: 1, x: 0, y: 800, pressure: 0.5, tiltX: 0, tiltY: 0, pointerType: 'pen', timestamp: 0 });
    const durations: number[] = [];
    const sampleCount = 1000;
    for (let index = 1; index <= sampleCount; index += 1) {
        const state = {
            id: 1,
            x: index * width / sampleCount,
            y: 800 + Math.sin(index / 80) * 120,
            pressure: 0.5,
            tiltX: 0,
            tiltY: 0,
            pointerType: 'pen',
            timestamp: index * 4,
        };
        const started = performance.now();
        tool.onPointerMove(state, ctx);
        durations.push(performance.now() - started);
    }
    tool.onPointerUp({ id: 1, x: width, y: 800, pressure: 0.5, tiltX: 0, tiltY: 0, pointerType: 'pen', timestamp: 4004 });
    const annotation = await completed;
    durations.sort((a, b) => a - b);

    const bitmap = await renderInkOffscreen([annotation], width, height, 1);
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const outputCtx = output.getContext('2d');
    if (!outputCtx) throw new Error('Output canvas 2D context is unavailable');
    outputCtx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = outputCtx.getImageData(0, 0, width, height).data;
    let nonTransparentPixels = 0;
    for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] > 0) nonTransparentPixels += 1;
    }

    return {
        supportsOffscreen: supportsOffscreenInk(),
        p95HandlerDrawMs: durations[Math.floor(durations.length * 0.95)],
        rawPointCount: sampleCount + 2,
        storedPointCount: annotation.geometry.points.length,
        bezierSegmentCount: annotation.geometry.beziers?.length || 0,
        compressionRatio: annotation.meta.compressionLevel || 1,
        nonTransparentPixels,
    };
}

declare global {
    interface Window {
        __marginRunInkBenchmark?: typeof runInkBenchmark;
    }
}

export function installInkDebugHook(): void {
    window.__marginRunInkBenchmark = runInkBenchmark;
    window.addEventListener('keydown', event => {
        if (!(event.ctrlKey && event.shiftKey && event.code === 'KeyB')) return;
        event.preventDefault();
        void runInkBenchmark()
            .then(result => {
                document.documentElement.dataset.marginInkBenchmark = JSON.stringify(result);
            })
            .catch(error => {
                document.documentElement.dataset.marginInkBenchmark = JSON.stringify({ error: String(error) });
            });
    });
}
