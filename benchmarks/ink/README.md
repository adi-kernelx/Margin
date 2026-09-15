# Ink performance gates

These targets were fixed before the phase 5–6 implementation:

- input sample to live-canvas draw: **p95 ≤ 16 ms** (one 60 Hz frame);
- stored Bézier coordinates: **≤ 20% of raw point coordinates** on the smooth-stroke fixture;
- fitting tolerance: **≤ 0.75 CSS pixel** at the capture viewport;
- the exact eraser must detect segment crossings even when neither captured endpoint is inside its swept disc.

The deterministic storage and geometry gates run in Vitest. End-to-end pen latency depends on the input hardware and browser compositor; record it with DevTools on a stylus device before publishing a hardware-specific number.

In a development build, `Ctrl+Shift+B` runs a detached 1,002-point stroke through the live renderer, stroke worker, and OffscreenCanvas worker. The result is written to `document.documentElement.dataset.marginInkBenchmark` for local inspection. This hook is excluded from production builds.
