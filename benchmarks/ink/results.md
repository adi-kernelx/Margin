# Ink benchmark results

## 2026-09-12 — Phase 5–6 implementation

- base revision: `f9c0944` on `phase-0-demolition` (working tree changes not committed);
- environment: Codex in-app Chromium browser, synthetic 1,002-point smooth stroke;
- live handler/draw p95: below the browser timer's displayed resolution (`0 ms`), target ≤16 ms;
- stored coordinate ratio: **8.78%**, target ≤20%;
- fitted path: 29 cubic Bézier segments, with 99 simplified hit-test points;
- OffscreenCanvas worker: supported and produced 5,024 non-transparent pixels.

This is a repeatable software-path check, not a claim about stylus hardware or compositor latency. A physical stylus trace is still required before publishing a device-specific pen-to-pixel number.
