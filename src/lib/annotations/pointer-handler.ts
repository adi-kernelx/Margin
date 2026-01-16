import type { PointerState } from './models';

export type PointerEventCallback = (state: PointerState) => void;

/**
 * Unified pointer handler that normalizes mouse/touch/stylus events
 * Supports pressure and tilt where available
 */
export class UnifiedPointerHandler {
    private activePointers = new Map<number, PointerState>();
    private element: HTMLElement;
    private callbacks: {
        down?: PointerEventCallback;
        move?: PointerEventCallback;
        up?: PointerEventCallback;
        cancel?: PointerEventCallback;
    } = {};

    constructor(element: HTMLElement) {
        this.element = element;
        this.attachListeners();
    }

    onPointerDown(callback: PointerEventCallback) {
        this.callbacks.down = callback;
    }

    onPointerMove(callback: PointerEventCallback) {
        this.callbacks.move = callback;
    }

    onPointerUp(callback: PointerEventCallback) {
        this.callbacks.up = callback;
    }

    onPointerCancel(callback: PointerEventCallback) {
        this.callbacks.cancel = callback;
    }

    private attachListeners() {
        this.element.addEventListener('pointerdown', this.handlePointerDown);
        this.element.addEventListener('pointermove', this.handlePointerMove);
        this.element.addEventListener('pointerup', this.handlePointerUp);
        this.element.addEventListener('pointercancel', this.handlePointerCancel);
        this.element.addEventListener('pointerleave', this.handlePointerCancel);
    }

    detach() {
        this.element.removeEventListener('pointerdown', this.handlePointerDown);
        this.element.removeEventListener('pointermove', this.handlePointerMove);
        this.element.removeEventListener('pointerup', this.handlePointerUp);
        this.element.removeEventListener('pointercancel', this.handlePointerCancel);
        this.element.removeEventListener('pointerleave', this.handlePointerCancel);
    }

    private handlePointerDown = (e: PointerEvent) => {
        e.preventDefault();

        // Capture pointer on the element (canvas) for better drag handling
        // This ensures we receive pointermove events even if cursor leaves the canvas
        this.element.setPointerCapture(e.pointerId);

        const state = this.extractPointerState(e);
        this.activePointers.set(e.pointerId, state);
        this.callbacks.down?.(state);
    };

    private throttledMove = throttlePointerMove((state: PointerState) => {
        this.callbacks.move?.(state);
    }, 60); // 60fps max

    private handlePointerMove = (e: PointerEvent) => {
        if (!this.activePointers.has(e.pointerId)) return;

        const state = this.extractPointerState(e);
        this.activePointers.set(e.pointerId, state);
        this.throttledMove(state);
    };

    private handlePointerUp = (e: PointerEvent) => {
        // Release pointer capture
        this.element.releasePointerCapture(e.pointerId);
        const state = this.extractPointerState(e);
        this.activePointers.delete(e.pointerId);
        this.callbacks.up?.(state);
    };

    private handlePointerCancel = (e: PointerEvent) => {
        const state = this.extractPointerState(e);
        this.activePointers.delete(e.pointerId);
        this.callbacks.cancel?.(state);
    };

    private extractPointerState(e: PointerEvent): PointerState {
        const rect = this.element.getBoundingClientRect();

        // Get CSS coordinates (client coordinates relative to element)
        // The canvas context is already scaled by devicePixelRatio, so we use CSS dimensions
        // This ensures coordinates match the scaled context coordinate system
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        return {
            id: e.pointerId,
            x,
            y,
            pressure: e.pressure,
            tiltX: e.tiltX || 0,
            tiltY: e.tiltY || 0,
            pointerType: e.pointerType,
            timestamp: performance.now(),
        };
    }

    getActivePointers(): PointerState[] {
        return Array.from(this.activePointers.values());
    }
}

/**
 * Throttle pointer move events to maintain performance
 */
export function throttlePointerMove(
    callback: PointerEventCallback,
    fps = 60
): PointerEventCallback {
    let lastTime = 0;
    const interval = 1000 / fps;

    return (state: PointerState) => {
        const now = performance.now();
        if (now - lastTime >= interval) {
            lastTime = now;
            callback(state);
        }
    };
}
