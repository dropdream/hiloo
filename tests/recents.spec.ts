import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, chooseOpen, chooseChanges, launchApplication, closeApplication } from './fixtures'

async function selectNotebook(application: ElectronApplication, page: Page, root: string) {
  await fs.mkdir(root, { recursive: true })
  await chooseOpen(application, root)
  expect(await page.evaluate(() => window.workspace.choose())).toEqual({ status: 'ok' })
  return (await page.evaluate(() => window.workspace.current()))!
}

test('recientes vacío se abre con teclado y Escape conserva el panel estrecho', async ({ application, editorPage: page }, testInfo) => {
  expect(await page.evaluate(() => window.workspace.recent())).toEqual([])
  const nativeWindow = await application.browserWindow(page)
  await nativeWindow.evaluate((window) => window.setSize(420, 700))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(420)
  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  const sidebar = page.getByRole('complementary', { name: 'Notas del cuaderno' })
  const trigger = sidebar.getByRole('button', { name: 'Cuadernos recientes', exact: true })
  const recent = sidebar.getByRole('region', { name: 'Lista de cuadernos recientes', exact: true })
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(recent).toContainText('Aún no hay cuadernos recientes.')
  await page.screenshot({ path: testInfo.outputPath('recientes-vacio-420.png') })
  await page.keyboard.press('Tab')
  expect(await sidebar.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await trigger.focus()
  await page.keyboard.press('Escape')
  await expect(recent).not.toBeVisible()
  await expect(sidebar).toBeVisible()
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(sidebar).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Mostrar cuaderno', exact: true })).toBeFocused()
})

test('recientes ordena, deduplica y limita a diez cuadernos elegidos explícitamente', async ({ application, editorPage: page }, testInfo) => {
  const roots = Array.from({ length: 11 }, (_, index) => testInfo.outputPath(`cuaderno-${index}`))
  for (const root of roots) await selectNotebook(application, page, root)
  const list = await page.evaluate(() => window.workspace.recent())
  expect(list.map((entry) => entry.path)).toEqual(roots.slice(1).reverse())
  expect(list.filter((entry) => entry.current).map((entry) => entry.path)).toEqual([roots[10]])
  const remembered = list.find((entry) => entry.path === roots[5])!
  await selectNotebook(application, page, roots[5])
  const reordered = await page.evaluate(() => window.workspace.recent())
  expect(reordered).toHaveLength(10)
  expect(reordered[0].id).toBe(remembered.id)
  expect(reordered[0].path).toBe(roots[5])
  expect(reordered.filter((entry) => entry.path === roots[5])).toHaveLength(1)
  expect(Number.isFinite(Date.parse(reordered[0].lastOpenedAt))).toBe(true)
  const looseRoot = testInfo.outputPath('carpeta-de-archivo-suelto')
  await fs.mkdir(looseRoot)
  const looseFile = join(looseRoot, 'suelta.md')
  await fs.writeFile(looseFile, '# Nota suelta\n')
  await chooseOpen(application, looseFile)
  expect(await page.evaluate(() => window.documents.open())).toEqual({ status: 'ok' })
  const afterLooseFile = await page.evaluate(() => window.workspace.recent())
  expect(afterLooseFile.map((entry) => entry.id)).toEqual(reordered.map((entry) => entry.id))
  expect(afterLooseFile.every((entry) => !entry.current)).toBe(true)
})

test('recientes persiste tras reiniciar y reabre sin selector de carpetas', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('Cuaderno persistente')
  await fs.mkdir(root)
  await fs.writeFile(join(root, 'nota.md'), '# Persistencia\n')
  await selectNotebook(application, page, root)
  const before = await page.evaluate(() => window.workspace.recent())
  await closeApplication(application)
  const restarted = await launchApplication(testInfo)
  try {
    const nextPage = await restarted.firstWindow()
    const errors: string[] = []
    nextPage.on('pageerror', (error) => errors.push(error.message))
    await expect(nextPage.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled()
    const after = await nextPage.evaluate(() => window.workspace.recent())
    expect(after).toEqual(before.map((entry) => ({ ...entry, current: false })))
    expect(await nextPage.evaluate(() => window.workspace.current())).toBeNull()
    await restarted.evaluate(({ dialog }) => {
      let calls = 0
      dialog.showOpenDialog = Object.assign(async () => {
        calls++
        return { canceled: true, filePaths: [] }
      }, { calls: () => calls })
    })
    await nextPage.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
    await nextPage.getByRole('button', { name: 'Cuadernos recientes', exact: true }).click()
    await nextPage.getByRole('button', { name: `Abrir cuaderno reciente: ${root}`, exact: true }).click()
    await nextPage.getByRole('dialog', { name: '¿Qué uso le darás al cuaderno?' }).getByRole('button', { name: 'Ahora no', exact: true }).click()
    await expect(nextPage.getByRole('button', { name: 'Abrir nota: nota.md', exact: true })).toBeVisible()
    expect((await nextPage.evaluate(() => window.workspace.current()))?.name).toBe('Cuaderno persistente')
    expect(await restarted.evaluate(({ dialog }) => (dialog.showOpenDialog as typeof dialog.showOpenDialog & { calls(): number }).calls())).toBe(0)
    await nextPage.getByRole('button', { name: 'Abrir nota: nota.md', exact: true }).click()
    await expect(nextPage.getByRole('textbox', { name: 'Documento Markdown' }).locator('h1')).toHaveText('Persistencia')
    expect(errors).toEqual([])
  } finally { await closeApplication(restarted) }
})

test('un historial corrupto permite iniciar y guardar nuevos cuadernos recientes', async ({ application, editorPage: page }, testInfo) => {
  await closeApplication(application)
  const history = testInfo.outputPath('.profile', 'recent-workspaces.json')
  await fs.writeFile(history, '{JSON incompleto')
  const restarted = await launchApplication(testInfo)
  try {
    const nextPage = await restarted.firstWindow()
    const errors: string[] = []
    nextPage.on('pageerror', (error) => errors.push(error.message))
    await expect(nextPage.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled()
    expect(await nextPage.evaluate(() => window.workspace.recent())).toEqual([])
    const root = testInfo.outputPath('recuperado')
    await selectNotebook(restarted, nextPage, root)
    const persisted = JSON.parse(await fs.readFile(history, 'utf8')) as { path: string }[]
    expect(persisted.map((entry) => entry.path)).toEqual([root])
    expect(errors).toEqual([])
  } finally { await closeApplication(restarted) }
})

test('recientes muestra rutas y actual, permite navegar con teclado y cabe en 420 px', async ({ application, editorPage: page }, testInfo) => {
  const firstRoot = testInfo.outputPath('Proyectos con un nombre largo para comprobar las rutas', 'Cuaderno')
  const secondRoot = testInfo.outputPath('Otro proyecto', 'Cuaderno')
  await selectNotebook(application, page, firstRoot)
  await selectNotebook(application, page, secondRoot)
  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  const sidebar = page.getByRole('complementary', { name: 'Notas del cuaderno' })
  await sidebar.getByRole('button', { name: 'Cuadernos recientes', exact: true }).click()
  const recent = sidebar.getByRole('region', { name: 'Lista de cuadernos recientes', exact: true })
  const current = recent.getByRole('button', { name: `Abrir cuaderno reciente: ${secondRoot}`, exact: true })
  await expect(current).toHaveAttribute('aria-current', 'true')
  await expect(current).toBeDisabled()
  await expect(current).toContainText('Actual')
  await expect(current).toContainText(secondRoot)
  await page.screenshot({ path: testInfo.outputPath('recientes-1000.png') })
  const nativeWindow = await application.browserWindow(page)
  for (const height of [700, 300]) {
    await nativeWindow.evaluate((window, height) => window.setSize(420, height), height)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(420)
    const target = recent.getByRole('button', { name: `Abrir cuaderno reciente: ${firstRoot}`, exact: true })
    await target.focus()
    await expect(target).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const bounds = await target.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
    await page.screenshot({ path: testInfo.outputPath(`recientes-420x${height}.png`) })
  }
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.workspace.recent().then((items) => items[0].path))).toBe(firstRoot)
  await expect(sidebar).toBeVisible()
})

test('cancelar un reciente conserva cambios y orden; descartar permite cambiar cuaderno', async ({ application, editorPage: page }, testInfo) => {
  const firstRoot = testInfo.outputPath('primero')
  const secondRoot = testInfo.outputPath('segundo')
  await selectNotebook(application, page, firstRoot)
  await fs.mkdir(secondRoot)
  await fs.writeFile(join(secondRoot, 'nota.md'), '# Original\n')
  const workspace = await selectNotebook(application, page, secondRoot)
  expect(await page.evaluate((id) => window.workspace.open(id), workspace.notes[0].id)).toEqual({ status: 'ok' })
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Código Markdown', exact: true })
  await source.fill('# Cambios pendientes\n')
  await expect.poll(() => page.evaluate(() => window.documents.current().then((document) => document.content))).toBe('# Cambios pendientes\n')
  const recent = await page.evaluate(() => window.workspace.recent())
  const target = recent.find((entry) => entry.path === firstRoot)!
  const before = await page.evaluate(() => window.documents.current())
  const beforeWorkspace = await page.evaluate(() => window.workspace.current())
  await application.evaluate(({ dialog }) => {
    let calls = 0
    dialog.showMessageBox = Object.assign(async () => {
      calls++
      return { response: 2, checkboxChecked: false }
    }, { calls: () => calls })
  })
  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  await page.getByRole('button', { name: 'Cuadernos recientes', exact: true }).click()
  const list = page.getByRole('region', { name: 'Lista de cuadernos recientes', exact: true })
  const recentButton = list.getByRole('button', { name: `Abrir cuaderno reciente: ${firstRoot}`, exact: true })
  await recentButton.click()
  await expect.poll(() => application.evaluate(({ dialog }) => (dialog.showMessageBox as typeof dialog.showMessageBox & { calls(): number }).calls())).toBe(1)
  await expect(recentButton).toBeEnabled()
  await expect(list).toBeVisible()
  await expect(recentButton).toBeFocused()
  expect(await page.evaluate(() => window.documents.current())).toEqual(before)
  expect(await page.evaluate(() => window.workspace.current())).toEqual(beforeWorkspace)
  expect(await page.evaluate(() => window.workspace.recent())).toEqual(recent)
  await expect(source).toHaveValue('# Cambios pendientes\n')
  await chooseChanges(application, 1)
  expect(await page.evaluate((id) => window.workspace.openRecent(id), target.id)).toEqual({ status: 'ok' })
  expect((await page.evaluate(() => window.workspace.recent()))[0].id).toBe(target.id)
  expect(await fs.readFile(join(secondRoot, 'nota.md'), 'utf8')).toBe('# Original\n')
})

test('un reciente inexistente muestra error y conserva documento, cuaderno y lista', async ({ application, editorPage: page }, testInfo) => {
  const missingRoot = testInfo.outputPath('cuaderno-desaparecido')
  await selectNotebook(application, page, missingRoot)
  await fs.rmdir(missingRoot)
  const workspace = await selectNotebook(application, page, testInfo.outputPath('cuaderno-vigente'))
  const editor = page.getByRole('textbox', { name: 'Documento Markdown', exact: true })
  await editor.fill('Edición que debe conservarse')
  await expect.poll(() => page.evaluate(() => window.documents.current().then((document) => document.dirty))).toBe(true)
  const before = await page.evaluate(() => window.documents.current())
  const recent = await page.evaluate(() => window.workspace.recent())
  await chooseChanges(application, 1)
  const nativeWindow = await application.browserWindow(page)
  await nativeWindow.evaluate((window) => window.setSize(420, 700))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(420)
  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  await page.getByRole('button', { name: 'Cuadernos recientes', exact: true }).click()
  await page.getByRole('button', { name: `Abrir cuaderno reciente: ${missingRoot}`, exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Notas del cuaderno' }).getByRole('alert')).toBeVisible()
  expect(await page.evaluate(() => window.documents.current())).toEqual(before)
  expect(await page.evaluate(() => window.workspace.current())).toEqual(workspace)
  expect(await page.evaluate(() => window.workspace.recent())).toEqual(recent)
  await expect(page.getByRole('complementary', { name: 'Notas del cuaderno' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('recientes-error-420.png') })
  await page.getByRole('button', { name: 'Cerrar panel de notas', exact: true }).click()
  await expect(editor).toHaveText('Edición que debe conservarse')
})

test('abrir reciente rechaza rutas e identificadores no autorizados', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('cuaderno-autorizado')
  const workspace = await selectNotebook(application, page, root)
  const before = await page.evaluate(() => window.documents.current())
  const recent = await page.evaluate(() => window.workspace.recent())
  for (const id of ['', 'no-autorizado', workspace.id, root, '..\\cuaderno-autorizado', '%2e%2e/cuaderno-autorizado', 'x'.repeat(5000)]) {
    expect((await page.evaluate((id) => window.workspace.openRecent(id), id)).status, id).toBe('error')
  }
  expect(await page.evaluate(() => window.documents.current())).toEqual(before)
  expect(await page.evaluate(() => window.workspace.current())).toEqual(workspace)
  expect(await page.evaluate(() => window.workspace.recent())).toEqual(recent)
})
