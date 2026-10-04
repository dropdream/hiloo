import { test as base, expect, _electron as electron, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { resolve } from 'node:path'

export async function launchApplication(testInfo: TestInfo): Promise<ElectronApplication> {
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_RENDERER_URL
  // Notebook scans skip hidden folders, including the browser data beside test documents.
  const profile = testInfo.outputPath('.profile')
  const application = await electron.launch({
    ...(testInfo.project.name === 'packaged'
      ? { executablePath: resolve(process.env.HILOO_TEST_PACKAGED_PATH ?? 'dist/win-unpacked/hiloo.exe'), args: [`--user-data-dir=${profile}`] }
      : { args: ['.', `--user-data-dir=${profile}`] }),
    env: environment
  })
  await application.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false })
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
  })
  expect(await application.evaluate(({ app }) => app.getPath('userData'))).toBe(profile)
  return application
}

export async function closeApplication(application: ElectronApplication): Promise<void> {
  await application.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await application.close().catch(() => {})
}

export const test = base.extend<{ application: ElectronApplication; editorPage: Page }>({
  application: async ({}, use, testInfo) => {
    const application = await launchApplication(testInfo)
    try { await use(application) } finally { await closeApplication(application) }
  },
  editorPage: async ({ application }, use) => {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled({ timeout: 30_000 })
    await use(page)
    expect(errors).toEqual([])
  }
})

export { expect }

export async function chooseOpen(application: ElectronApplication, path?: string) {
  await application.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: !path, filePaths: path ? [path] : [] }) }, path)
}

export async function chooseSave(application: ElectronApplication, path?: string) {
  await application.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: !path, filePath: path ?? '' }) }, path)
}

export async function chooseChanges(application: ElectronApplication, response: 0 | 1 | 2) {
  await application.evaluate(({ dialog }, response) => { dialog.showMessageBox = async () => ({ response, checkboxChecked: false }) }, response)
}
