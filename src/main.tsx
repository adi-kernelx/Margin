import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted fonts. A Google Fonts link would break the offline promise, so
// both faces ship as npm packages and load from the bundle. Variable Plus
// Jakarta Sans covers the whole weight range in one file; JetBrains Mono is
// only used at 400 and 500.
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'

import './index.css'
import App from './App'
import { ThemeProvider } from './lib/theme/ThemeProvider'

if (import.meta.env.DEV) {
  void import('./lib/metrics/ink-debug').then(({ installInkDebugHook }) => installInkDebugHook())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
