// Stand-in for demo-only modules outside the demo build (vite.config.ts). The
// dynamic imports that point here are dead code in that build; aliasing them
// keeps Vite from emitting their assets, such as the bundled sample PDF.
export {};
