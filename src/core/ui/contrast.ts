// WCAG 2.1 relative luminance and contrast ratio for hex colours.
//
// Used by the design-token contrast test to guarantee that every text token
// remains readable against every surface token in both themes. Pure and DOM-
// free so it can run on tokens.css at build time.

/** Parses "#RGB" or "#RRGGBB" into [r, g, b] in [0, 255]. */
export function parseHex(hex: string): [number, number, number] {
    const clean = hex.trim().replace(/^#/, '');
    if (clean.length !== 3 && clean.length !== 6) {
        throw new Error(`Not a hex colour: ${hex}`);
    }

    const expand = clean.length === 3
        ? clean.split('').map(character => character + character).join('')
        : clean;

    const value = parseInt(expand, 16);
    if (Number.isNaN(value)) throw new Error(`Not a hex colour: ${hex}`);

    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Converts a single sRGB 8-bit channel to its linear-light value. */
function channelToLinear(channel: number): number {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance in [0, 1]. */
export function relativeLuminance(hex: string): number {
    const [r, g, b] = parseHex(hex);
    return (
        0.2126 * channelToLinear(r) +
        0.7152 * channelToLinear(g) +
        0.0722 * channelToLinear(b)
    );
}

/** WCAG contrast ratio in [1, 21]. Order of arguments does not matter. */
export function contrastRatio(foreground: string, background: string): number {
    const foregroundLuminance = relativeLuminance(foreground);
    const backgroundLuminance = relativeLuminance(background);
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG AA thresholds we hold Margin to.
 *
 * `normalText` is body copy and interface labels. `largeText` is 24 px + or
 * 18.66 px bold — the app rarely uses it, but it appears in section headers.
 * `nonText` covers icon-only controls, focus rings, and the boundary between
 * two adjacent UI surfaces where a difference must be perceivable.
 */
export const CONTRAST = {
    normalText: 4.5,
    largeText: 3.0,
    nonText: 3.0,
} as const;
