import { useEffect, useRef } from 'react';
import { gradientField } from '@/core/ui/parallax';

// A deliberately coarse grid, upscaled with smoothing: a few hundred cells
// per frame keeps the hero well under a millisecond of work.
const COLUMNS = 48;
const ROWS = 28;

function readColor(name: string, fallback: [number, number, number]): [number, number, number] {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const match = /^#([0-9a-f]{6})$/i.exec(raw);
    if (!match) return fallback;
    const value = parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * The showcase hero: a slow generative field in the accent and ground
 * colours. Draws a single still frame under reduced motion, and pauses while
 * off screen or in a background tab.
 */
export function GradientField({ className }: { className?: string }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        canvas.width = COLUMNS;
        canvas.height = ROWS;
        const image = context.createImageData(COLUMNS, ROWS);

        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let visible = true;
        let frame = 0;
        const started = performance.now();

        const draw = (now: number) => {
            // Colours are re-read each frame so a theme switch applies at once.
            const from = readColor('--ground', [244, 246, 248]);
            const to = readColor('--accent', [11, 94, 86]);
            const t = reduced ? 3 : (now - started) / 1000;
            for (let row = 0; row < ROWS; row += 1) {
                for (let column = 0; column < COLUMNS; column += 1) {
                    const { mix, intensity } = gradientField(column / COLUMNS, row / ROWS, t);
                    const weight = mix * intensity * 0.85;
                    const offset = (row * COLUMNS + column) * 4;
                    image.data[offset] = from[0] + (to[0] - from[0]) * weight;
                    image.data[offset + 1] = from[1] + (to[1] - from[1]) * weight;
                    image.data[offset + 2] = from[2] + (to[2] - from[2]) * weight;
                    image.data[offset + 3] = 255;
                }
            }
            context.putImageData(image, 0, 0);
            if (!reduced && visible) frame = requestAnimationFrame(draw);
        };

        const resume = () => {
            cancelAnimationFrame(frame);
            if (visible && !document.hidden) frame = requestAnimationFrame(draw);
        };
        const observer = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            resume();
        });
        observer.observe(canvas);
        document.addEventListener('visibilitychange', resume);
        frame = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            document.removeEventListener('visibilitychange', resume);
        };
    }, []);

    return <canvas ref={canvasRef} aria-hidden="true" className={className} style={{ imageRendering: 'auto' }} />;
}
