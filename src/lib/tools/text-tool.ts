import { BaseTool } from './base-tool';
import type { PointerState, TextAnnotation, BoundingBox } from '../annotations/models';
import { normalizePoint } from '../rendering/stroke-smoother';

export interface TextToolCallbacks {
    onCreateTextInput: (x: number, y: number, width: number, height: number, onComplete: (text: string) => void) => void;
}

export class TextTool extends BaseTool {
    private pageWidth = 0;
    private pageHeight = 0;
    private color = '#000000';
    private fontSize = 16;
    private fontFamily = 'Arial';
    private callbacks: TextToolCallbacks | null = null;
    private defaultWidth = 200;
    private defaultHeight = 50;

    constructor(
        pageWidth: number,
        pageHeight: number,
        callbacks: TextToolCallbacks,
        color = '#000000',
        fontSize = 16,
        fontFamily = 'Arial'
    ) {
        super();
        this.pageWidth = pageWidth;
        this.pageHeight = pageHeight;
        this.callbacks = callbacks;
        this.color = color;
        this.fontSize = fontSize;
        this.fontFamily = fontFamily;
    }

    setColor(color: string): void {
        this.color = color;
    }

    setFontSize(size: number): void {
        this.fontSize = size;
    }

    setFontFamily(family: string): void {
        this.fontFamily = family;
    }

    updatePageDimensions(width: number, height: number): void {
        this.pageWidth = width;
        this.pageHeight = height;
    }

    onPointerDown(state: PointerState, _ctx: CanvasRenderingContext2D): void {
        if (!this.callbacks) return;

        // Normalize coordinates

        // Create text input at click position
        this.callbacks.onCreateTextInput(
            state.x,
            state.y,
            this.defaultWidth,
            this.defaultHeight,
            (_text: string) => {
                // This callback will be handled by the component
            }
        );
    }

    onPointerMove(_state: PointerState, _ctx: CanvasRenderingContext2D): void {
        // Text tool doesn't need pointer move for creation
    }

    onPointerUp(_state: PointerState, _ctx: CanvasRenderingContext2D): null {
        // Text creation is handled by the input overlay
        return null;
    }

    render(_ctx: CanvasRenderingContext2D): void {
        // Text tool doesn't render preview on canvas
        // Text is rendered via DOM overlay
    }

    getCursor(): string {
        return 'text';
    }

    /**
     * Create a TextAnnotation from text input
     */
    createAnnotation(
        x: number,
        y: number,
        width: number,
        height: number,
        text: string
    ): TextAnnotation {
        // Normalize coordinates
        const normalized = normalizePoint(x, y, this.pageWidth, this.pageHeight);
        const normalizedWidth = width / this.pageWidth;
        const normalizedHeight = height / this.pageHeight;

        const boundingBox: BoundingBox = {
            x: normalized.x,
            y: normalized.y,
            width: normalizedWidth,
            height: normalizedHeight,
        };

        return {
            id: `text-${Date.now()}-${Math.random()}`,
            type: 'text',
            pageNum: 1, // Will be set by the canvas component
            createdAt: Date.now(),
            updatedAt: Date.now(),
            zIndex: 0,
            locked: false,
            style: {
                color: this.color,
                opacity: 1,
                fontSize: this.fontSize,
                fontFamily: this.fontFamily,
            },
            meta: {
                tool: 'text',
            },
            geometry: {
                boundingBox,
            },
            content: text,
        };
    }
}


