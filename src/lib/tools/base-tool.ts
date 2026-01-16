import type { PointerState, Annotation } from '../annotations/models';

/**
 * Base class for all annotation tools
 * Provides common interface and lifecycle hooks
 */
export abstract class BaseTool {
    protected isActive = false;
    protected isDrawing = false;

    /**
     * Called when the tool becomes active
     */
    activate(): void {
        this.isActive = true;
    }

    /**
     * Called when the tool becomes inactive
     */
    deactivate(): void {
        this.isActive = false;
        this.isDrawing = false;
    }

    /**
     * Called on pointer down event
     */
    abstract onPointerDown(state: PointerState, ctx: CanvasRenderingContext2D): void;

    /**
     * Called on pointer move event
     */
    abstract onPointerMove(state: PointerState, ctx: CanvasRenderingContext2D): void;

    /**
     * Called on pointer up event
     * Returns the completed annotation if one was created
     */
    abstract onPointerUp(state: PointerState, ctx: CanvasRenderingContext2D): Annotation | null;

    /**
     * Called to render the tool's current state (e.g., preview)
     */
    abstract render(ctx: CanvasRenderingContext2D): void;

    /**
     * Get the cursor style for this tool
     */
    abstract getCursor(): string;
}
