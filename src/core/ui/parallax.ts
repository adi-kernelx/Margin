// Pure geometry for the demo showcase: pointer parallax offsets and the
// generative gradient field drawn on the hero canvas. The shell reads the
// pointer and owns the canvas; everything numeric lives here.

export interface ParallaxInput {
    /** Pointer position relative to the container, in px. */
    pointerX: number;
    pointerY: number;
    width: number;
    height: number;
    /** 0 = pinned to the background, 1 = nearest layer. */
    depth: number;
    /** Largest offset for the nearest layer, in px. */
    maxOffset: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Translation for one layer. Nearer layers move further and in the pointer's
 * direction, which reads as depth. Zero-size containers yield no motion.
 */
export function parallaxOffset({ pointerX, pointerY, width, height, depth, maxOffset }: ParallaxInput): { x: number; y: number } {
    if (width <= 0 || height <= 0) return { x: 0, y: 0 };
    const nx = clamp(pointerX / width, 0, 1) * 2 - 1;
    const ny = clamp(pointerY / height, 0, 1) * 2 - 1;
    const reach = clamp(depth, 0, 1) * maxOffset;
    return { x: nx * reach, y: ny * reach };
}

export interface FieldSample {
    /** 0..1 mix between the two field colours. */
    mix: number;
    /** 0..1 brightness of this cell. */
    intensity: number;
}

/**
 * A smooth, looping scalar field built from three travelling sine waves.
 * `t` is time in seconds; `x` and `y` are normalised 0..1 coordinates. The
 * output is bounded, so the renderer never has to clamp.
 */
export function gradientField(x: number, y: number, t: number): FieldSample {
    const a = Math.sin(x * 5.1 + t * 0.35);
    const b = Math.sin(y * 4.3 - t * 0.27 + a * 0.8);
    const c = Math.sin((x + y) * 3.7 + t * 0.19);
    const value = (a + b + c) / 3; // -1..1
    return {
        mix: (value + 1) / 2,
        intensity: 0.35 + 0.65 * ((Math.sin(value * Math.PI) + 1) / 2),
    };
}
