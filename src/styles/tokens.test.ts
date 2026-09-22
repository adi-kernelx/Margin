// Design-token contrast test.
//
// Parses src/styles/tokens.css and asserts that every text token remains
// readable against every surface token, in both themes. The plan's F1
// acceptance criterion — "contrast test passes for both themes" — is exactly
// this file passing.
//
// A failure here means one of the tokens was changed in a way that would
// produce unreadable copy on a real surface. Fix the value; do not weaken
// the assertion.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRAST, contrastRatio } from '@/core/ui/contrast';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, './tokens.css'), 'utf8');

/**
 * Extracts a hex value for the given token from a specific block of the
 * stylesheet. Not a general CSS parser — it looks for `  --name: #RRGGBB;`
 * lines, which is the only shape tokens.css uses for colour values.
 */
function readToken(block: string, name: string): string {
    const pattern = new RegExp(`--${name}\\s*:\\s*(#[0-9A-Fa-f]{3,6})\\s*;`);
    const match = block.match(pattern);
    if (!match) throw new Error(`No hex definition for --${name} in the given block`);
    return match[1];
}

/** Returns the CSS between an opening selector and its matching close brace. */
function extractBlock(css: string, selector: string): string {
    const start = css.indexOf(selector);
    if (start < 0) throw new Error(`Selector ${selector} missing from tokens.css`);
    const open = css.indexOf('{', start);
    let depth = 1;
    for (let index = open + 1; index < css.length; index++) {
        if (css[index] === '{') depth++;
        else if (css[index] === '}') {
            depth--;
            if (depth === 0) return css.slice(open + 1, index);
        }
    }
    throw new Error(`Unclosed block for ${selector}`);
}

const light = extractBlock(source, ':root');
const dark = extractBlock(source, ':root.dark');

/**
 * Pairs to check per theme.
 *
 * - `text` on `ground` and every raised surface — the body-copy floor.
 * - `text-soft` and `text-muted` on the surfaces they actually sit on.
 * - `text-on-accent` on the accent (button labels).
 * - `accent` on ground (accent used as a foreground colour, e.g. links).
 */
const textPairs = [
    { fg: 'text',           bg: 'ground',    label: 'body on ground'     },
    { fg: 'text',           bg: 'surface-1', label: 'body on surface-1'  },
    { fg: 'text',           bg: 'surface-2', label: 'body on surface-2'  },
    { fg: 'text',           bg: 'surface-3', label: 'body on surface-3'  },
    { fg: 'text',           bg: 'surface-4', label: 'body on surface-4'  },
    { fg: 'text-soft',      bg: 'ground',    label: 'soft on ground'     },
    { fg: 'text-soft',      bg: 'surface-2', label: 'soft on surface-2'  },
    { fg: 'text-muted',     bg: 'ground',    label: 'muted on ground'    },
    { fg: 'text-muted',     bg: 'surface-2', label: 'muted on surface-2' },
    { fg: 'text-on-accent', bg: 'accent',    label: 'label on accent'    },
] as const;

/** Non-text UI: the accent used as a fill or icon on the ground. */
const nonTextPairs = [
    { fg: 'accent', bg: 'ground', label: 'accent icon on ground' },
] as const;

describe.each([
    { theme: 'light', block: light },
    { theme: 'dark',  block: dark  },
])('tokens.css contrast ($theme)', ({ block }) => {
    it.each(textPairs)('$label meets AA body threshold', ({ fg, bg }) => {
        const ratio = contrastRatio(readToken(block, fg), readToken(block, bg));
        expect(ratio).toBeGreaterThanOrEqual(CONTRAST.normalText);
    });

    it.each(nonTextPairs)('$label meets non-text threshold', ({ fg, bg }) => {
        const ratio = contrastRatio(readToken(block, fg), readToken(block, bg));
        expect(ratio).toBeGreaterThanOrEqual(CONTRAST.nonText);
    });
});
