import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { build: { externalizeDeps: false } },
  preload: {},
  renderer: {
    plugins: [
      react(),
      {
        name: 'csp-development',
        apply: 'serve',
        // El preámbulo de React Refresh necesita código inline durante desarrollo.
        transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      }
    ],
    server: { host: '127.0.0.1' }
  }
})
