import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
// `--mode demo` builds the static demo (see .env.demo and src/lib/features.ts)
// into its own folder, with relative asset paths so it can be served from any
// sub-path of any static host.
export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? './' : '/',
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
  },
  plugins: [react()],
  resolve: {
    alias: [
      // Demo: replace the OCR hook module so Tesseract and the service
      // clients are never bundled. Everything else: stub the demo-only
      // modules so their assets are not emitted. Both precede the "@" alias.
      ...(mode === 'demo'
        ? [{ find: '@/hooks/useOcr', replacement: path.resolve(__dirname, './src/hooks/useOcr.demo.ts') }]
        : [{ find: /^@\/demo\/.*$/, replacement: path.resolve(__dirname, './src/lib/empty-module.ts') }]),
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  worker: {
    format: 'es',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      }
    }
  }
}))
