import { BaseTool } from './base-tool';
import type { PointerState, MathAnnotation, BoundingBox } from '../annotations/models';
import { normalizePoint } from '../rendering/stroke-smoother';

export interface MathToolCallbacks {
    onPlace: (x: number, y: number) => void;
}

export class MathTool extends BaseTool {
    private callbacks: MathToolCallbacks;

    constructor(
        _pageWidth: number,
        _pageHeight: number,
        callbacks: MathToolCallbacks
    ) {
        super();
        this.callbacks = callbacks;
    }

    onPointerDown(_state: PointerState, _ctx: CanvasRenderingContext2D): void { }

    onPointerMove(_state: PointerState, _ctx: CanvasRenderingContext2D): void { }

    onPointerUp(state: PointerState, _ctx: CanvasRenderingContext2D): null {
        // We notify callback to handle the placement logic (which might rely on external state)
        this.callbacks.onPlace(state.x, state.y);
        return null;
    }

    render(_ctx: CanvasRenderingContext2D): void { }

    getCursor(): string {
        return 'crosshair';
    }

    updatePageDimensions(_width: number, _height: number): void {
        // this.pageWidth = width;
        // this.pageHeight = height;
    }

    /**
     * static helper to create annotation object
     */
    static createAnnotation(
        x: number,
        y: number,
        content: string,
        displayMode: boolean,
        pageWidth: number,
        pageHeight: number,
        style: any = {}
    ): MathAnnotation {
        // Default box size - might need adjustment based on content size measurement
        const width = 200;
        const height = 100;

        const normalized = normalizePoint(x, y, pageWidth, pageHeight);
        const normalizedWidth = width / pageWidth;
        const normalizedHeight = height / pageHeight;

        const boundingBox: BoundingBox = {
            x: normalized.x,
            y: normalized.y,
            width: normalizedWidth,
            height: normalizedHeight,
        };

        return {
            id: `math-${Date.now()}-${Math.random()}`,
            type: 'math',
            pageNum: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            zIndex: 2,
            locked: false,
            style: {
                color: style.color || '#000000',
                opacity: 1,
                fontSize: style.fontSize || 16,
            },
            meta: {
                tool: 'math',
            },
            geometry: {
                boundingBox,
            },
            content,
            svgDataUrl: style.svgDataUrl, // passed via style for convenience or modify signature
            displayMode,
        };
    }
}
