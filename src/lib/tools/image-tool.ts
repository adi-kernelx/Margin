import { BaseTool } from './base-tool';
import type { PointerState, ImageAnnotation, BoundingBox } from '../annotations/models';
import { normalizePoint } from '../rendering/stroke-smoother';

export interface ImageToolCallbacks {
    onImagePaste: (x: number, y: number, imageData: string) => void;
    onImageUpload: (x: number, y: number, imageData: string) => void;
}

export class ImageTool extends BaseTool {
    private pageWidth = 0;
    private pageHeight = 0;
    private callbacks: ImageToolCallbacks | null = null;


    constructor(
        pageWidth: number,
        pageHeight: number,
        callbacks: ImageToolCallbacks
    ) {
        super();
        this.pageWidth = pageWidth;
        this.pageHeight = pageHeight;
        this.callbacks = callbacks;
    }

    updatePageDimensions(width: number, height: number): void {
        this.pageWidth = width;
        this.pageHeight = height;
    }

    onPointerDown(_state: PointerState, _ctx: CanvasRenderingContext2D): void {
        // Just store the position - actual paste happens on Ctrl+V
        // The position is stored in AnnotationCanvas via lastImageClickRef
    }

    onPointerMove(_state: PointerState, _ctx: CanvasRenderingContext2D): void {
        // Image tool doesn't need pointer move
    }

    onPointerUp(_state: PointerState, _ctx: CanvasRenderingContext2D): null {
        // Image creation is handled by paste/upload
        return null;
    }

    render(_ctx: CanvasRenderingContext2D): void {
        // Image tool doesn't render preview
    }

    getCursor(): string {
        return 'crosshair';
    }

    /**
     * Attempt to paste image from clipboard at given position
     */
    async pasteImageFromClipboard(x: number, y: number): Promise<boolean> {
        try {
            const clipboardItems = await navigator.clipboard.read();

            for (const item of clipboardItems) {
                for (const type of item.types) {
                    if (type.startsWith('image/')) {
                        const blob = await item.getType(type);
                        const reader = new FileReader();

                        reader.onloadend = () => {
                            const base64 = reader.result as string;
                            if (this.callbacks) {
                                this.callbacks.onImagePaste(x, y, base64);
                            }
                        };

                        reader.readAsDataURL(blob);
                        return true;
                    }
                }
            }
        } catch (err) {
            // Clipboard API might not be available or user denied permission
            console.warn('Failed to read from clipboard:', err);
        }
        return false;
    }

    /**
     * Create an ImageAnnotation from image data
     */
    createAnnotation(
        x: number,
        y: number,
        width: number,
        height: number,
        imageData: string
    ): ImageAnnotation {
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
            id: `image-${Date.now()}-${Math.random()}`,
            type: 'image',
            pageNum: 1, // Will be set by the canvas component
            createdAt: Date.now(),
            updatedAt: Date.now(),
            zIndex: 2, // Layer 3 (images) - higher z-index
            locked: false,
            style: {
                color: '#000000',
                opacity: 1,
            },
            meta: {
                tool: 'image',
            },
            geometry: {
                boundingBox,
            },
            imageData,
        };
    }
}

