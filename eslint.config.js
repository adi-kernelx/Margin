import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },

  // The core/shell boundary (see CLAUDE.md).
  //
  // src/core holds the parts of the system with no environment: geometry,
  // command semantics, cache policy. It must stay runnable in plain Node, which
  // is what lets it be unit-tested without a browser and, later, reused outside
  // this frontend. Everything it needs from the outside arrives as an argument
  // or a port interface, never as an import.
  //
  // If this rule fires, the fix is almost never to add an exception — it is to
  // move the impure part out to a shell and pass it in.
  {
    files: ['src/core/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['@/lib/*', '@/components/*', '@/hooks/*', '@/pages/*', '../lib/*', '../../lib/*'],
            message: 'src/core must not depend on a shell. Move the pure part into core, or pass the dependency in.',
          },
          {
            group: ['react', 'react-dom', 'react-*', 'zustand', 'idb', 'dexie', 'pdfjs-dist', 'pdf-lib', 'axios'],
            message: 'src/core must stay free of framework, storage, PDF and network libraries.',
          },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'window', message: 'src/core must not touch the DOM.' },
        { name: 'document', message: 'src/core must not touch the DOM.' },
        { name: 'localStorage', message: 'src/core must not touch browser storage.' },
        { name: 'indexedDB', message: 'src/core must not touch browser storage.' },
        { name: 'fetch', message: 'src/core must not make network calls; inject a port instead.' },
      ],
    },
  },

  // Tests may reach anywhere; they are a shell like any other.
  {
    files: ['**/*.test.ts', 'src/core/**/test-factories.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
])
