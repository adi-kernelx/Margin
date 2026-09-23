// Pure FLIP (First, Last, Invert, Play) computation.
//
// The shell captures each item's bounding rectangle before a reorder, applies
// the reorder (which changes the DOM), captures the new rectangles, and then
// invokes `computeFlip` to derive the inverse transform that visually places
// each item back in its old position. The shell plays that transform to
// identity with the Web Animations API.
//
// Only the arithmetic lives here; the DOM interaction stays in the shell so
// the core has no dependency on measurement.

export interface FlipRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface FlipDelta {
    /** The old position minus the new position, on each axis. */
    dx: number;
    dy: number;
    /** Ratio between old and new dimensions; 1 when the item did not resize. */
    sx: number;
    sy: number;
}

/**
 * Item positions were valid only when both rectangles were measured. If the
 * item didn't exist before or after the reorder the delta is undefined and
 * the shell skips the animation for that key.
 */
export function computeFlip(before: FlipRect, after: FlipRect): FlipDelta {
    const sx = after.width === 0 ? 1 : before.width / after.width;
    const sy = after.height === 0 ? 1 : before.height / after.height;
    return {
        dx: before.x - after.x,
        dy: before.y - after.y,
        sx,
        sy,
    };
}

/**
 * Builds a CSS transform expressing the inverse — apply it as the starting
 * state and animate to `transform: none` to play the item into position.
 */
export function invertTransform(delta: FlipDelta): string {
    return `translate(${delta.dx.toFixed(2)}px, ${delta.dy.toFixed(2)}px) scale(${delta.sx.toFixed(4)}, ${delta.sy.toFixed(4)})`;
}

/**
 * A no-op delta, useful as the identity element for animations that must run
 * unconditionally even when nothing needs to move.
 */
export const IDENTITY_DELTA: FlipDelta = { dx: 0, dy: 0, sx: 1, sy: 1 };
