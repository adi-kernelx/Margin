// Pure keyboard-shortcut parsing and matching for the action registry.
//
// Shortcuts are written as "Mod+K", "Shift+?", "Alt+ArrowLeft". "Mod" means
// Ctrl on Windows/Linux and Cmd on macOS, decided by the caller.

export interface KeyLike {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
}

export interface ParsedShortcut {
    key: string;
    mod: boolean;
    alt: boolean;
    shift: boolean;
}

export function parseShortcut(shortcut: string): ParsedShortcut {
    const parts = shortcut.split('+');
    // A literal "+" key is written as "Mod++", which splits into a trailing empty part.
    const key = parts[parts.length - 1] === '' ? '+' : parts[parts.length - 1];
    const modifiers = new Set(parts.slice(0, -1).map(part => part.toLowerCase()));
    return {
        key: key.toLowerCase(),
        mod: modifiers.has('mod') || modifiers.has('ctrl') || modifiers.has('cmd'),
        alt: modifiers.has('alt'),
        shift: modifiers.has('shift'),
    };
}

// Printable symbols already imply Shift on most layouts, so "?" should match
// whether or not the event reports shiftKey.
const SHIFTED_SYMBOLS = new Set(['?', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', '{', '}', '|', ':', '"', '<', '>', '~']);

export function matchesShortcut(event: KeyLike, shortcut: string, isMac: boolean): boolean {
    const parsed = parseShortcut(shortcut);
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (event.key.toLowerCase() !== parsed.key) return false;
    if (mod !== parsed.mod || event.altKey !== parsed.alt) return false;
    if (SHIFTED_SYMBOLS.has(parsed.key)) return true;
    return event.shiftKey === parsed.shift;
}

const KEY_LABELS: Record<string, string> = {
    arrowleft: '←',
    arrowright: '→',
    arrowup: '↑',
    arrowdown: '↓',
    escape: 'Esc',
    enter: '↵',
};

/** Human-readable key caps for display, e.g. ["Ctrl", "K"]. */
export function shortcutLabel(shortcut: string, isMac: boolean): string[] {
    const parsed = parseShortcut(shortcut);
    const caps: string[] = [];
    if (parsed.mod) caps.push(isMac ? '⌘' : 'Ctrl');
    if (parsed.alt) caps.push(isMac ? '⌥' : 'Alt');
    if (parsed.shift && !SHIFTED_SYMBOLS.has(parsed.key)) caps.push(isMac ? '⇧' : 'Shift');
    caps.push(KEY_LABELS[parsed.key] ?? (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key));
    return caps;
}

/** True when typing in this element should not trigger single-key shortcuts. */
export function isEditableTarget(tagName: string | undefined, isContentEditable: boolean): boolean {
    return isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}
