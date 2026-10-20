import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  outputDir: '../../../.verification/capturas',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  projects: [{ name: 'local' }]
})
