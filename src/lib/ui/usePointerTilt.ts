// Pointer-tilt hook — the shell over @/core/ui/tilt.
//
// It reads DOM bounds and pointer position, calls the pure geometry, then
// writes CSS custom properties on the element. Nothing about how the tilt is
// computed lives here; nothing about the DOM lives in the core.

import { useCallback, useEffect, useRef, type PointerEvent } from 'react';
import { computeTilt, RESTING_TILT } from '@/core/ui/tilt';

interface UsePointerTiltOptions {
    /** Read from tokens; overridable per surface. Defaults to `--tilt-max`. */
    maxTiltDegrees?: number;
    /** Skip the tilt entirely; used when the surface is a page card in a
        reduced-motion review, or when the caller wants a hard opt-out. */
    disabled?: boolean;
}

/**
 * Returns the pointer handlers for a tilt card and applies the resting tilt
 * on mount so an unmounted state matches the untilted state.
 *
 * The element is typed as HTMLElement so any tag can be a tilt surface — a
 * `<button>` card, an `<a>` card, or a `<div>` list item.
 */
export function usePointerTilt<T extends HTMLElement>({
    maxTiltDegrees,
    disabled = false,
}: UsePointerTiltOptions = {}) {
    const ref = useRef<T | null>(null);
    const frame = useRef<number | null>(null);

    // Honour prefers-reduced-motion at attach time; the tokens.css guard
    // already zeroes --tilt-max, but skipping the pointer bookkeeping saves
    // per-frame work when the effect would be invisible anyway.
    const reduced = useRef(false);
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        reduced.current = query.matches;
        const listener = (event: MediaQueryListEvent) => { reduced.current = event.matches; };
        query.addEventListener('change', listener);
        return () => query.removeEventListener('change', listener);
    }, []);

    // Fine-pointer only. Coarse pointers (touch) get no tilt because the
    // finger has to hover over the target it also blocks from view, and every
    // element the surface owns needs a non-hover alternative anyway.
    const coarse = useRef(false);
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        coarse.current = window.matchMedia('(pointer: coarse)').matches;
    }, []);

    const write = useCallback((rotateX: number, rotateY: number, sheenX: number, sheenY: number) => {
        const element = ref.current;
        if (!element) return;
        element.style.setProperty('--card-rx', `${rotateX.toFixed(2)}deg`);
        element.style.setProperty('--card-ry', `${rotateY.toFixed(2)}deg`);
        element.style.setProperty('--sheen-x', `${sheenX.toFixed(1)}%`);
        element.style.setProperty('--sheen-y', `${sheenY.toFixed(1)}%`);
    }, []);

    const onPointerMove = useCallback((event: PointerEvent<T>) => {
        if (disabled || reduced.current || coarse.current) return;
        const element = ref.current;
        if (!element) return;

        // rAF-throttle so a busy pointer moves at most once per frame; the
        // per-frame work stays a couple of writes to custom properties.
        if (frame.current !== null) return;
        const { clientX, clientY } = event;
        frame.current = window.requestAnimationFrame(() => {
            frame.current = null;
            const rect = element.getBoundingClientRect();
            const max = maxTiltDegrees
                ?? (parseFloat(getComputedStyle(element).getPropertyValue('--tilt-max')) || 4);
            const tilt = computeTilt({
                pointerX: clientX - rect.left,
                pointerY: clientY - rect.top,
                width: rect.width,
                height: rect.height,
                maxTiltDegrees: max,
            });
            write(tilt.rotateX, tilt.rotateY, tilt.sheenX, tilt.sheenY);
        });
    }, [disabled, maxTiltDegrees, write]);

    const rest = useCallback(() => {
        if (frame.current !== null) {
            window.cancelAnimationFrame(frame.current);
            frame.current = null;
        }
        write(RESTING_TILT.rotateX, RESTING_TILT.rotateY, RESTING_TILT.sheenX, RESTING_TILT.sheenY);
        const element = ref.current;
        if (element) element.style.removeProperty('will-change');
    }, [write]);

    const onPointerEnter = useCallback(() => {
        const element = ref.current;
        if (element && !disabled && !reduced.current && !coarse.current) {
            // Only while the pointer is over the card. A permanent layer on
            // a 200-card grid costs memory the app cannot afford.
            element.style.willChange = 'transform';
        }
    }, [disabled]);

    return { ref, onPointerMove, onPointerEnter, onPointerLeave: rest, onBlur: rest };
}
