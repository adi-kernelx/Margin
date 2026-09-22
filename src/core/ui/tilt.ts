// Pure pointer-tilt geometry.
//
// Given a pointer position inside a card, produce clamped rotation angles and
// a sheen origin. Kept in the core so the tilt math is unit-tested without a
// DOM: the hook in @/lib/ui/usePointerTilt.ts is a thin shell that reads
// bounds from the browser and writes CSS custom properties.

export interface TiltInput {
    /** Pointer X in the card's client rectangle (px from left). */
    pointerX: number;
    /** Pointer Y in the card's client rectangle (px from top). */
    pointerY: number;
    width: number;
    height: number;
    /** Maximum absolute rotation on either axis, in degrees. */
    maxTiltDegrees: number;
}

export interface TiltOutput {
    /** rotateX in degrees; positive tips the top away from the viewer. */
    rotateX: number;
    /** rotateY in degrees; positive turns the right edge away from the viewer. */
    rotateY: number;
    /** Sheen origin in percent of the card, ready for a radial-gradient position. */
    sheenX: number;
    sheenY: number;
}

const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));

/**
 * Maps a pointer position to a tilt. The Y axis is inverted so that hovering
 * the top of the card tips it away from the viewer, which is what the eye
 * expects for "leaning towards the light".
 */
export function computeTilt(input: TiltInput): TiltOutput {
    const { pointerX, pointerY, width, height, maxTiltDegrees } = input;

    if (width <= 0 || height <= 0 || maxTiltDegrees <= 0) {
        return { rotateX: 0, rotateY: 0, sheenX: 50, sheenY: 50 };
    }

    // Normalised position in [-0.5, 0.5], clamped so pointer overshoot at the
    // edges (drag events fire outside the element) does not tilt past the cap.
    const nx = clamp(pointerX / width - 0.5, -0.5, 0.5);
    const ny = clamp(pointerY / height - 0.5, -0.5, 0.5);

    return {
        rotateY: nx * maxTiltDegrees * 2,
        rotateX: -ny * maxTiltDegrees * 2,
        sheenX: (nx + 0.5) * 100,
        sheenY: (ny + 0.5) * 100,
    };
}

/** The neutral (untitled) output; used when the pointer leaves the card. */
export const RESTING_TILT: TiltOutput = {
    rotateX: 0,
    rotateY: 0,
    sheenX: 50,
    sheenY: 50,
};
