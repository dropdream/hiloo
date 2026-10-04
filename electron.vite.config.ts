import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'brain-cli': resolve('src/main/brain-cli.ts')
        }
      }
    }
  },
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
