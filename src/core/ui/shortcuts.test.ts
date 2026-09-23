import { describe, expect, it } from 'vitest';
import { isEditableTarget, matchesShortcut, parseShortcut, shortcutLabel } from './shortcuts';

const key = (value: string, modifiers: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
    key: value,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
});

describe('parseShortcut', () => {
    it('reads modifiers and the key', () => {
        expect(parseShortcut('Mod+Shift+P')).toEqual({ key: 'p', mod: true, alt: false, shift: true });
    });

    it('handles a literal plus key', () => {
        expect(parseShortcut('Mod++').key).toBe('+');
    });
});

describe('matchesShortcut', () => {
    it('maps Mod to Ctrl off macOS and Cmd on macOS', () => {
        expect(matchesShortcut(key('k', { ctrlKey: true }), 'Mod+K', false)).toBe(true);
        expect(matchesShortcut(key('k', { ctrlKey: true }), 'Mod+K', true)).toBe(false);
        expect(matchesShortcut(key('k', { metaKey: true }), 'Mod+K', true)).toBe(true);
    });

    it('requires modifiers to match exactly', () => {
        expect(matchesShortcut(key('k'), 'Mod+K', false)).toBe(false);
        expect(matchesShortcut(key('k', { ctrlKey: true, altKey: true }), 'Mod+K', false)).toBe(false);
    });

    it('accepts shifted symbols regardless of reported Shift', () => {
        expect(matchesShortcut(key('?', { shiftKey: true }), '?', false)).toBe(true);
        expect(matchesShortcut(key('?'), '?', false)).toBe(true);
    });
});

describe('shortcutLabel', () => {
    it('renders platform key caps', () => {
        expect(shortcutLabel('Mod+K', false)).toEqual(['Ctrl', 'K']);
        expect(shortcutLabel('Mod+K', true)).toEqual(['⌘', 'K']);
        expect(shortcutLabel('Alt+ArrowLeft', false)).toEqual(['Alt', '←']);
    });
});

describe('isEditableTarget', () => {
    it('recognises form fields and contenteditable', () => {
        expect(isEditableTarget('INPUT', false)).toBe(true);
        expect(isEditableTarget('DIV', true)).toBe(true);
        expect(isEditableTarget('BUTTON', false)).toBe(false);
    });
});
