import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  outputDir: '.verification/test-results',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  projects: [
    { name: 'local' },
    { name: 'packaged' }
  ]
})
