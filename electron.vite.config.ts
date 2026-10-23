import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'

// Solo valores públicos del .env; la clave secreta de Supabase nunca entra al paquete.
const cloudEnv = loadEnv('', process.cwd(), ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'AUTH0_DOMAIN', 'AUTH0_CLIENT_ID'])
const cloud = {
  supabaseUrl: cloudEnv.SUPABASE_URL,
  supabasePublishableKey: cloudEnv.SUPABASE_PUBLISHABLE_KEY,
  auth0Domain: cloudEnv.AUTH0_DOMAIN,
  auth0ClientId: cloudEnv.AUTH0_CLIENT_ID
}

export default defineConfig({
  main: {
    define: { __HILOO_CLOUD__: JSON.stringify(cloud) },
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'brain-cli': resolve('src/main/brain-cli.ts'),
          'brain-mcp': resolve('src/main/brain-mcp.ts')
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
