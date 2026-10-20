import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { test, expect, chooseOpen, chooseSave, chooseChanges, launchApplication, closeApplication } from './fixtures'

async function notebook(application: ElectronApplication, page: Page, root: string, notes: Record<string, string>) {
  await fs.mkdir(root, { recursive: true })
  for (const [name, content] of Object.entries(notes)) await fs.writeFile(join(root, name), content)
  await chooseOpen(application, root)
  expect(await page.evaluate(() => window.workspace.choose())).toEqual({ status: 'ok' })
  return (await page.evaluate(() => window.workspace.current()))!
}

const noteId = (snapshot: { notes: { id: string; name: string }[] }, name: string) =>
  snapshot.notes.find((note) => note.name === name)!.id

test('la pestaña muestra el nombre de la nota y su ruta completa', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('pestana-unica')
  const snapshot = await notebook(application, page, root, { 'alfa.md': '# Alfa\n' })
  expect(await page.evaluate((id) => window.workspace.open(id), noteId(snapshot, 'alfa.md'))).toEqual({ status: 'ok' })
  const tabs = page.getByRole('tablist', { name: 'Documentos abiertos' })
  const tab = tabs.getByRole('tab', { name: 'alfa.md', exact: true })
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(tab).toHaveAttribute('title', join(root, 'alfa.md'))
  await expect(tabs.getByRole('tab')).toHaveCount(1)
})

test('el clic en la barra lateral reemplaza la pestaña y el menú contextual abre otra', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('menu-contextual')
  const snapshot = await notebook(application, page, root, { 'alfa.md': '# Alfa\n', 'beta.md': '# Beta\n', 'gamma.md': '# Gamma\n' })
  expect(await page.evaluate((id) => window.workspace.open(id), noteId(snapshot, 'alfa.md'))).toEqual({ status: 'ok' })
  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  const sidebar = page.getByRole('complementary', { name: 'Notas del cuaderno' })
  const tabs = page.getByRole('tablist', { name: 'Documentos abiertos' })
  await sidebar.getByRole('button', { name: 'Abrir nota: beta.md' }).click()
  await expect(tabs.getByRole('tab')).toHaveText(['beta.md'])
  await sidebar.getByRole('button', { name: 'Abrir nota: gamma.md' }).click({ button: 'right' })
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'Abrir en nueva pestaña' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('menu-contextual.png') })
  await menu.getByRole('menuitem', { name: 'Abrir en nueva pestaña' }).click()
  await expect(tabs.getByRole('tab')).toHaveText(['beta.md', 'gamma.md'])
  await expect(tabs.getByRole('tab', { name: 'gamma.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('textbox', { name: 'Documento Markdown' })).toHaveText('Gamma')
  // Una nota ya abierta se enfoca en lugar de duplicarse.
  await sidebar.getByRole('button', { name: 'Abrir nota: beta.md' }).focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Abrir en nueva pestaña' }).press('Enter')
  await expect(tabs.getByRole('tab', { name: 'beta.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: 'Documento Markdown' })).toHaveText('Beta')
})

test('cada pestaña conserva sus cambios sin guardar, su historial y su desplazamiento', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('estado-por-pestana')
  const long = Array.from({ length: 80 }, (_, index) => `Párrafo ${index + 1}.`).join('\n\n')
  const snapshot = await notebook(application, page, root, { 'alfa.md': `# Alfa\n\n${long}\n`, 'beta.md': '# Beta\n' })
  expect(await page.evaluate((id) => window.workspace.open(id), noteId(snapshot, 'alfa.md'))).toEqual({ status: 'ok' })
  const area = page.locator('#document-workspace')
  await area.evaluate((element) => (element.scrollTop = 600))
  expect(await page.evaluate((id) => window.workspace.open(id, 'new-tab'), noteId(snapshot, 'beta.md'))).toEqual({ status: 'ok' })
  const tabs = page.getByRole('tablist', { name: 'Documentos abiertos' })
  const alfa = tabs.getByRole('tab', { name: 'alfa.md', exact: true })
  const beta = tabs.getByRole('tab', { name: 'beta.md', exact: true })
  const editor = page.getByRole('textbox', { name: 'Documento Markdown' })
  await expect(beta).toHaveAttribute('aria-selected', 'true')
  await expect(editor).toHaveText('Beta')
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' editada')
  await expect(editor).toHaveText('Beta editada')
  await expect(beta).toHaveAttribute('data-dirty', 'true')
  await expect(beta).toHaveAccessibleDescription('Cambios sin guardar')
  await alfa.click()
  await expect(alfa).toHaveAttribute('aria-selected', 'true')
  await expect(editor).toContainText('Párrafo 80.')
  await expect.poll(() => area.evaluate((element) => element.scrollTop)).toBe(600)
  await expect(beta).toHaveAttribute('data-dirty', 'true')
  await expect(alfa).not.toHaveAttribute('data-dirty')
  await page.keyboard.press('Control+Tab')
  await expect(beta).toHaveAttribute('aria-selected', 'true')
  await expect(editor).toHaveText('Beta editada')
  expect((await page.evaluate(() => window.documents.current())).dirty).toBe(true)
  // El historial de beta sobrevive al cambio de pestaña.
  await expect(page.getByRole('status')).toHaveText('Cambios sin guardar')
  await expect(editor).toBeFocused()
  await page.keyboard.press('Control+z')
  await expect(editor).toHaveText('Beta')
  await expect(beta).not.toHaveAttribute('data-dirty')
  await page.keyboard.press('Control+Shift+Tab')
  await expect(alfa).toHaveAttribute('aria-selected', 'true')
  await page.screenshot({ path: testInfo.outputPath('pestanas.png') })
})

test('cerrar con ×, clic central y Ctrl+W confirma los cambios pendientes como al cambiar de documento', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('cerrar-pestanas')
  const snapshot = await notebook(application, page, root, { 'a.md': '# A\n', 'b.md': '# B\n', 'c.md': '# C\n', 'd.md': '# D\n' })
  for (const [index, name] of ['a.md', 'b.md', 'c.md', 'd.md'].entries())
    expect(await page.evaluate(([id, target]) => window.workspace.open(id, target), [noteId(snapshot, name), index ? 'new-tab' : 'current'] as const)).toEqual({ status: 'ok' })
  const tabs = page.getByRole('tablist', { name: 'Documentos abiertos' })
  const editor = page.getByRole('textbox', { name: 'Documento Markdown' })
  await expect(tabs.getByRole('tab')).toHaveText(['a.md', 'b.md', 'c.md', 'd.md'])
  await tabs.getByRole('button', { name: 'Cerrar b.md' }).click()
  await expect(tabs.getByRole('tab')).toHaveText(['a.md', 'c.md', 'd.md'])
  await expect(tabs.getByRole('tab', { name: 'd.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  await tabs.getByRole('tab', { name: 'a.md', exact: true }).click({ button: 'middle' })
  await expect(tabs.getByRole('tab')).toHaveText(['c.md', 'd.md'])
  await expect(page.getByRole('status')).toHaveText('Guardado')
  // d.md con cambios: Cancelar la conserva.
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' sin guardar')
  await chooseChanges(application, 2)
  await page.keyboard.press('Control+w')
  await expect(page.getByRole('status')).toHaveText('Cambios sin guardar')
  await expect(tabs.getByRole('tab')).toHaveText(['c.md', 'd.md'])
  await expect(editor).toHaveText('D sin guardar')
  // Cerrar otra pestaña con cambios la muestra antes de preguntar; Descartar la cierra.
  await tabs.getByRole('tab', { name: 'c.md', exact: true }).click()
  await expect(editor).toHaveText('C')
  await chooseChanges(application, 1)
  const closeD = tabs.getByRole('button', { name: 'Cerrar d.md' })
  await expect(closeD).toBeEnabled()
  await tabs.getByRole('tab', { name: 'd.md', exact: true }).hover()
  await closeD.click()
  await expect(tabs.getByRole('tab')).toHaveText(['c.md'])
  expect(await fs.readFile(join(root, 'd.md'), 'utf8')).toBe('# D\n')
  await expect(page.getByRole('status')).toHaveText('Guardado')
  await page.keyboard.press('Control+w')
  await expect(tabs.getByRole('tab')).toHaveText(['Sin título'])
  await expect(editor).toHaveText('')
})

test('las pestañas y la activa se restauran al reabrir y se omiten las notas que ya no existen', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('restaurar')
  const snapshot = await notebook(application, page, root, { 'a.md': '# A\n', 'b.md': '# B\n', 'c.md': '# C\n' })
  for (const [index, name] of ['a.md', 'b.md', 'c.md'].entries())
    expect(await page.evaluate(([id, target]) => window.workspace.open(id, target), [noteId(snapshot, name), index ? 'new-tab' : 'current'] as const)).toEqual({ status: 'ok' })
  const tabs = page.getByRole('tablist', { name: 'Documentos abiertos' })
  await tabs.getByRole('tab', { name: 'b.md', exact: true }).click()
  await expect(tabs.getByRole('tab', { name: 'b.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(async () => JSON.parse(await fs.readFile(testInfo.outputPath('.profile', 'open-tabs.json'), 'utf8')).active).toBe(1)
  await closeApplication(application)
  await fs.rm(join(root, 'c.md'))
  const restarted = await launchApplication(testInfo)
  try {
    const next = await restarted.firstWindow()
    const errors: string[] = []
    next.on('pageerror', (error) => errors.push(error.message))
    const restoredTabs = next.getByRole('tablist', { name: 'Documentos abiertos' })
    await expect(restoredTabs.getByRole('tab')).toHaveText(['a.md', 'b.md'])
    await expect(restoredTabs.getByRole('tab', { name: 'b.md', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(next.getByRole('textbox', { name: 'Documento Markdown' })).toHaveText('B')
    await expect(next.getByRole('alert')).toHaveCount(0)
    await restoredTabs.getByRole('tab', { name: 'a.md', exact: true }).click()
    await expect(next.getByRole('textbox', { name: 'Documento Markdown' })).toHaveText('A')
    expect(errors).toEqual([])
  } finally {
    await closeApplication(restarted)
  }
})

test('crear una nota la abre en una pestaña nueva sin tocar la actual', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('nota-nueva')
  const snapshot = await notebook(application, page, root, { 'a.md': '# A\n' })
  expect(await page.evaluate((id) => window.workspace.open(id), noteId(snapshot, 'a.md'))).toEqual({ status: 'ok' })
  const editor = page.getByRole('textbox', { name: 'Documento Markdown' })
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' pendiente')
  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  const sidebar = page.getByRole('complementary', { name: 'Notas del cuaderno' })
  await sidebar.getByRole('button', { name: 'Nueva nota .md', exact: true }).click()
  const form = sidebar.getByRole('form', { name: 'Crear nota', exact: true })
  await form.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Nueva')
  await form.getByRole('button', { name: 'Crear', exact: true }).click()
  const tabs = page.getByRole('tablist', { name: 'Documentos abiertos' })
  await expect(tabs.getByRole('tab')).toHaveText(['a.md', 'Nueva.md'])
  await expect(tabs.getByRole('tab', { name: 'Nueva.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.getByRole('tab', { name: 'a.md', exact: true })).toHaveAttribute('data-dirty', 'true')
  expect(await fs.readFile(join(root, 'a.md'), 'utf8')).toBe('# A\n')
})

test('con muchas pestañas la barra se desplaza sin cambiar de altura', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('desbordamiento')
  const names = Array.from({ length: 14 }, (_, index) => `nota con nombre largo ${String(index + 1).padStart(2, '0')}.md`)
  const snapshot = await notebook(application, page, root, Object.fromEntries(names.map((name) => [name, `# ${name}\n`])))
  const tabs = page.getByRole('tablist', { name: 'Documentos abiertos' })
  const height = await tabs.evaluate((element) => element.getBoundingClientRect().height)
  for (const name of names) expect(await page.evaluate((id) => window.workspace.open(id, 'new-tab'), noteId(snapshot, name))).toEqual({ status: 'ok' })
  await expect(tabs.getByRole('tab')).toHaveCount(names.length)
  expect(await tabs.evaluate((element) => element.getBoundingClientRect().height)).toBe(height)
  expect(await tabs.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  await expect(tabs.getByRole('tab', { name: names.at(-1), exact: true })).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('desbordamiento.png') })
  // La rueda vertical desplaza la barra y al estrechar la ventana la activa sigue visible.
  await tabs.hover()
  await page.mouse.wheel(0, -2000)
  await expect.poll(() => tabs.evaluate((element) => element.scrollLeft)).toBe(0)
  await tabs.getByRole('tab', { name: names[3], exact: true }).click()
  await (await application.browserWindow(page)).evaluate((window) => window.setSize(420, 700))
  await expect(tabs.getByRole('tab', { name: names[3], exact: true })).toBeInViewport({ ratio: 1 })
  expect(await tabs.evaluate((element) => element.getBoundingClientRect().height)).toBe(height)
})

test('un cambio externo en una pestaña inactiva se detecta al guardarla', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('cambio-externo')
  const snapshot = await notebook(application, page, root, { 'a.md': '# A\n', 'b.md': '# B\n' })
  expect(await page.evaluate((id) => window.workspace.open(id), noteId(snapshot, 'a.md'))).toEqual({ status: 'ok' })
  expect(await page.evaluate((id) => window.workspace.open(id, 'new-tab'), noteId(snapshot, 'b.md'))).toEqual({ status: 'ok' })
  const tabs = page.getByRole('tablist', { name: 'Documentos abiertos' })
  const editor = page.getByRole('textbox', { name: 'Documento Markdown' })
  await tabs.getByRole('tab', { name: 'a.md', exact: true }).click()
  await expect(editor).toHaveText('A')
  await fs.writeFile(join(root, 'b.md'), '# B externo\n')
  await tabs.getByRole('tab', { name: 'b.md', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Guardado')
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' local')
  await page.keyboard.press('Control+s')
  await expect(page.getByRole('alert')).toContainText('El archivo cambió fuera de hiloo')
  expect(await fs.readFile(join(root, 'b.md'), 'utf8')).toBe('# B externo\n')
  await expect(tabs.getByRole('tab', { name: 'b.md', exact: true })).toHaveAttribute('data-dirty', 'true')
})

test('en modo Markdown cada pestaña muestra y conserva su propio código', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('modo-markdown')
  const snapshot = await notebook(application, page, root, { 'a.md': '# A\n', 'b.md': '# B\n' })
  expect(await page.evaluate((id) => window.workspace.open(id), noteId(snapshot, 'a.md'))).toEqual({ status: 'ok' })
  expect(await page.evaluate((id) => window.workspace.open(id, 'new-tab'), noteId(snapshot, 'b.md'))).toEqual({ status: 'ok' })
  const tabs = page.getByRole('tablist', { name: 'Documentos abiertos' })
  const source = page.getByRole('textbox', { name: 'Código Markdown', exact: true })
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await source.fill('# B\n\nEscrito en código.\n')
  await tabs.getByRole('tab', { name: 'a.md', exact: true }).click()
  await expect(source).toHaveValue('# A\n')
  await tabs.getByRole('tab', { name: 'b.md', exact: true }).click()
  await expect(source).toHaveValue('# B\n\nEscrito en código.\n')
  await expect(page.getByRole('status')).toHaveText('Cambios sin guardar')
  await page.getByRole('button', { name: 'Vista impresión', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Documento Markdown' })).toContainText('Escrito en código.')
})

test('abrir en nueva pestaña la nota activa no la duplica', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('misma-nota')
  const snapshot = await notebook(application, page, root, { 'a.md': '# A\n', 'b.md': '# B\n' })
  expect(await page.evaluate((id) => window.workspace.open(id), noteId(snapshot, 'a.md'))).toEqual({ status: 'ok' })
  expect(await page.evaluate((id) => window.workspace.open(id, 'new-tab'), noteId(snapshot, 'b.md'))).toEqual({ status: 'ok' })
  const editor = page.getByRole('textbox', { name: 'Documento Markdown' })
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' local')
  expect(await page.evaluate((id) => window.workspace.open(id, 'new-tab'), noteId(snapshot, 'b.md'))).toEqual({ status: 'ok' })
  const tabs = await page.evaluate(() => window.documents.tabs())
  expect(tabs.tabs.map((tab) => [tab.name, tab.dirty])).toEqual([['a.md', false], ['b.md', true]])
  await expect(editor).toHaveText('B local')
})

test('Guardar como sobre un archivo abierto en otra pestaña se rechaza sin tocarlo', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('guardar-como-abierto')
  const snapshot = await notebook(application, page, root, { 'a.md': '# A\n', 'b.md': '# B\n' })
  expect(await page.evaluate((id) => window.workspace.open(id), noteId(snapshot, 'a.md'))).toEqual({ status: 'ok' })
  expect(await page.evaluate((id) => window.workspace.open(id, 'new-tab'), noteId(snapshot, 'b.md'))).toEqual({ status: 'ok' })
  await chooseSave(application, join(root, 'a.md'))
  // Si llegara a preguntar por reemplazar, la respuesta sería Reemplazar.
  await chooseChanges(application, 0)
  const result = await page.evaluate(() => window.documents.save(true))
  expect(result).toEqual({ status: 'error', message: 'a.md ya está abierto en otra pestaña. Ciérrala o elige otro nombre.' })
  expect(await fs.readFile(join(root, 'a.md'), 'utf8')).toBe('# A\n')
  const tabs = await page.evaluate(() => window.documents.tabs())
  expect(tabs.tabs.map((tab) => tab.path)).toEqual([join(root, 'a.md'), join(root, 'b.md')])
})

// Arranca hiloo reteniendo `lstat` de ciertas notas hasta que exista su señal; mientras espera, deja `<señal>.esperando`.
async function launchHeld(testInfo: TestInfo, saved: { paths: string[]; active: number }, holds: { suffix: string; gate: string; skip?: number }[]) {
  const profile = testInfo.outputPath('.profile')
  await fs.mkdir(profile, { recursive: true })
  await fs.writeFile(join(profile, 'open-tabs.json'), JSON.stringify(saved))
  const hook = testInfo.outputPath('retener-lectura.cjs')
  await fs.writeFile(hook, `const fs = require('node:fs')
const rules = ${JSON.stringify(holds.map((hold) => ({ skip: 0, ...hold })))}
const original = fs.promises.lstat
fs.promises.lstat = async function (path, ...rest) {
  for (const rule of rules) {
    if (!String(path).endsWith(rule.suffix) || rule.skip-- > 0 || fs.existsSync(rule.gate)) continue
    fs.writeFileSync(rule.gate + '.esperando', '')
    while (!fs.existsSync(rule.gate)) await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return original.call(this, path, ...rest)
}
`)
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const application = await electron.launch({ args: ['--require', hook, '.', `--user-data-dir=${profile}`], env })
  await application.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false })
  })
  const page = await application.firstWindow()
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled({ timeout: 30_000 })
  return { application, page }
}

// Carpetas separadas: el cuaderno del usuario no debe leer lenta.md al escanearse.
async function restoreFolders(testInfo: TestInfo, name: string) {
  const restoredRoot = testInfo.outputPath(name, 'restauradas')
  const userRoot = testInfo.outputPath(name, 'usuario')
  await fs.mkdir(restoredRoot, { recursive: true })
  await fs.mkdir(userRoot, { recursive: true })
  const first = join(restoredRoot, 'a.md')
  const slow = join(restoredRoot, 'lenta.md')
  const mine = join(userRoot, 'mia.md')
  await fs.writeFile(first, '# A\n')
  await fs.writeFile(slow, '# Lenta\n')
  await fs.writeFile(mine, '# Mía\n')
  return { userRoot, first, slow, mine, gate: testInfo.outputPath('liberar') }
}

const heldOnly = 'El ejecutable empaquetado no admite --require para retener la lectura.'

test('la restauración tardía no quita el foco a la nota que el usuario ya abrió', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'local', heldOnly)
  const { first, slow, mine, gate } = await restoreFolders(testInfo, 'restauracion-tardia')
  const { application, page } = await launchHeld(testInfo, { paths: [first, slow], active: 1 }, [{ suffix: 'lenta.md', gate }])
  try {
    await chooseOpen(application, mine)
    expect(await page.evaluate(() => window.documents.open())).toEqual({ status: 'ok' })
    const editor = page.getByRole('textbox', { name: 'Documento Markdown' })
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' editada')
    const tabs = page.getByRole('tablist', { name: 'Documentos abiertos' })
    await expect(tabs.getByRole('tab')).toHaveText(['mia.md'])
    await fs.writeFile(gate, '')
    await expect(tabs.getByRole('tab')).toHaveText(['mia.md', 'a.md', 'lenta.md'])
    await expect(tabs.getByRole('tab', { name: 'mia.md', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(editor).toHaveText('Mía editada')
  } finally {
    await closeApplication(application)
  }
})

test('abrir una nota mientras la restauración la añade no la duplica', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'local', heldOnly)
  const { slow, mine, gate } = await restoreFolders(testInfo, 'restauracion-carrera')
  const userGate = testInfo.outputPath('liberar-mia')
  // La primera lectura de mia.md es la de la restauración; la segunda, la del usuario, queda retenida.
  const { application, page } = await launchHeld(testInfo, { paths: [mine, slow], active: 0 }, [
    { suffix: 'lenta.md', gate },
    { suffix: 'mia.md', gate: userGate, skip: 1 }
  ])
  try {
    await chooseOpen(application, mine)
    const opening = page.evaluate(() => window.documents.open())
    await expect.poll(() => fs.access(`${userGate}.esperando`).then(() => true, () => false)).toBe(true)
    await fs.writeFile(gate, '')
    const tabs = page.getByRole('tablist', { name: 'Documentos abiertos' })
    await expect(tabs.getByRole('tab')).toHaveCount(3)
    await fs.writeFile(userGate, '')
    expect(await opening).toEqual({ status: 'ok' })
    await expect(tabs.getByRole('tab')).toHaveText(['mia.md', 'lenta.md'])
    await expect(tabs.getByRole('tab', { name: 'mia.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  } finally {
    await closeApplication(application)
  }
})

test('la restauración tardía no añade pestañas al cuaderno que el usuario eligió después', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'local', heldOnly)
  const { userRoot, first, slow, gate } = await restoreFolders(testInfo, 'restauracion-otro-cuaderno')
  const { application, page } = await launchHeld(testInfo, { paths: [first, slow], active: 0 }, [{ suffix: 'lenta.md', gate }])
  try {
    await chooseOpen(application, userRoot)
    expect(await page.evaluate(() => window.workspace.choose())).toEqual({ status: 'ok' })
    await fs.writeFile(gate, '')
    const saved = testInfo.outputPath('.profile', 'open-tabs.json')
    await expect.poll(async () => JSON.parse(await fs.readFile(saved, 'utf8')).paths).toEqual([])
    await expect(page.getByRole('tablist', { name: 'Documentos abiertos' }).getByRole('tab')).toHaveText(['Sin título'])
  } finally {
    await closeApplication(application)
  }
})

test('cambiar o cerrar una pestaña marca la nota actual sin volver a explorar el cuaderno', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('cambio-sin-escaneo')
  const snapshot = await notebook(application, page, root, { 'alfa.md': '# Alfa\n', 'beta.md': '# Beta\n' })
  expect(await page.evaluate((id) => window.workspace.open(id), noteId(snapshot, 'alfa.md'))).toEqual({ status: 'ok' })
  expect(await page.evaluate((id) => window.workspace.open(id, 'new-tab'), noteId(snapshot, 'beta.md'))).toEqual({ status: 'ok' })
  // Una nota creada fuera de hiloo solo aparece al actualizar, abrir o guardar.
  await fs.writeFile(join(root, 'gamma.md'), '# Gamma\n')
  const names = (current: { notes: { name: string }[] }) => current.notes.map((note) => note.name)
  const { tabs } = await page.evaluate(() => window.documents.tabs())
  expect(await page.evaluate((id) => window.documents.activate(id), tabs[0].id)).toEqual({ status: 'ok' })
  let current = (await page.evaluate(() => window.workspace.current()))!
  expect(current.currentNoteId).toBe(noteId(snapshot, 'alfa.md'))
  expect(names(current)).toEqual(['alfa.md', 'beta.md'])
  expect(await page.evaluate((id) => window.documents.closeTab(id), tabs[0].id)).toEqual({ status: 'ok' })
  current = (await page.evaluate(() => window.workspace.current()))!
  expect(current.currentNoteId).toBe(noteId(snapshot, 'beta.md'))
  expect(names(current)).toEqual(['alfa.md', 'beta.md'])
  expect(await page.evaluate(() => window.workspace.refresh())).toEqual({ status: 'ok' })
  current = (await page.evaluate(() => window.workspace.current()))!
  expect(names(current)).toEqual(['alfa.md', 'beta.md', 'gamma.md'])
})

test('Abrir sobre una nota ya abierta en otra pestaña la enfoca sin preguntar', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('abrir-ya-abierta')
  const snapshot = await notebook(application, page, root, { 'a.md': '# A\n', 'b.md': '# B\n' })
  expect(await page.evaluate((id) => window.workspace.open(id), noteId(snapshot, 'a.md'))).toEqual({ status: 'ok' })
  expect(await page.evaluate((id) => window.workspace.open(id, 'new-tab'), noteId(snapshot, 'b.md'))).toEqual({ status: 'ok' })
  const editor = page.getByRole('textbox', { name: 'Documento Markdown' })
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' local')
  await expect.poll(async () => (await page.evaluate(() => window.documents.tabs())).tabs[1].dirty).toBe(true)
  // Si preguntara, la respuesta sería Cancelar y no se abriría nada.
  await chooseChanges(application, 2)
  await chooseOpen(application, join(root, 'a.md'))
  expect(await page.evaluate(() => window.documents.open())).toEqual({ status: 'ok' })
  const tabs = page.getByRole('tablist', { name: 'Documentos abiertos' })
  await expect(tabs.getByRole('tab', { name: 'a.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  const state = await page.evaluate(() => window.documents.tabs())
  expect(state.tabs.map((tab) => [tab.name, tab.dirty])).toEqual([['a.md', false], ['b.md', true]])
})
