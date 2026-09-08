import { defineConfig } from 'vitest/config';
import path from 'path';

// Kept separate from vite.config.ts so the app build never carries test config.
export default defineConfig({
    resolve: {
        alias: { '@': path.resolve(__dirname, './src') },
    },
    test: {
        // Node, not jsdom: every module under test here is meant to be free of
        // DOM dependencies, so running without a DOM is itself part of the test.
        environment: 'node',
        include: ['src/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/lib/**/*.ts'],
        },
    },
});
