import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import type { Core } from 'cytoscape'
import { test, expect, chooseOpen, chooseChanges } from './fixtures'

async function writeNotes(root: string, notes: Record<string, string>) {
  for (const [relativePath, content] of Object.entries(notes)) {
    const path = join(root, relativePath)
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, content)
  }
}

async function selectNotebook(application: ElectronApplication, page: Page, root: string) {
  await chooseOpen(application, root)
  expect(await page.evaluate(() => window.workspace.choose())).toEqual({ status: 'ok' })
  const snapshot = await page.evaluate(() => window.workspace.current())
  expect(snapshot).not.toBeNull()
  return snapshot!
}

async function openNote(page: Page, relativePath: string) {
  const snapshot = await page.evaluate(() => window.workspace.current())
  const note = snapshot?.notes.find((entry) => entry.relativePath === relativePath)
  expect(note, relativePath).toBeDefined()
  return page.evaluate((id) => window.workspace.open(id), note!.id)
}

test('cuaderno explora subcarpetas, filtra por ruta y abre notas Markdown', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('cuaderno')
  await writeNotes(root, {
    'inicio.md': '# Inicio\n',
    'clientes/Caso.markdown': '# Caso del cliente\n',
    'clientes/adjunto.txt': 'No es una nota',
    'imagen.svg': '<svg />'
  })
  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  await chooseOpen(application, root)
  await page.getByRole('button', { name: 'Abrir cuaderno', exact: true }).click()
  const sidebar = page.getByRole('complementary', { name: 'Notas del cuaderno' })
  await expect(sidebar.getByRole('button', { name: 'Abrir nota:', exact: false })).toHaveCount(2)
  await sidebar.getByRole('searchbox', { name: 'Buscar notas' }).fill('clientes/')
  await expect(sidebar.getByRole('button', { name: 'Abrir nota:', exact: false })).toHaveCount(1)
  await sidebar.getByRole('button', { name: 'Abrir nota: clientes/Caso.markdown', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Documento Markdown' }).locator('h1')).toHaveText('Caso del cliente')
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled()
  const snapshot = await page.evaluate(() => window.workspace.current())
  expect(snapshot?.notes.map((note) => note.relativePath).sort()).toEqual(['clientes/Caso.markdown', 'inicio.md'])
  expect(snapshot?.currentNoteId).toBe(snapshot?.notes.find((note) => note.relativePath === 'clientes/Caso.markdown')?.id)
  await page.screenshot({ path: testInfo.outputPath('cuaderno-sidebar.png') })
})

test('grafo usa enlaces Markdown reales con referencias, espacios y anclas', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('grafo')
  await writeNotes(root, {
    'inicio.md': [
      '[Caso](clientes/Caso%20uno.md#resumen)',
      '[Duplicado](clientes/Caso%20uno.md)',
      '[Referencia][agenda]',
      '',
      '[agenda]: agenda.markdown',
      '',
      '[Externo](https://example.com/aislada.md)',
      '[Fuera](../fuera.md)',
      '[Absoluto](/aislada.md)',
      '[Ancla](#inicio)',
      '[Inexistente](ausente.md)',
      '[Malformado](%ZZ.md)',
      '![Imagen](aislada.md)',
      '`[Código inline](aislada.md)`',
      '```md',
      '[Código bloque](aislada.md)',
      '```'
    ].join('\n'),
    'clientes/Caso uno.md': '# Caso\n\n[Volver](../inicio.md#inicio)\n',
    'agenda.markdown': '# Agenda\n',
    'aislada.md': '# Aislada\n'
  })
  await fs.writeFile(testInfo.outputPath('fuera.md'), '# Fuera\n')
  const snapshot = await selectNotebook(application, page, root)
  const paths = new Map(snapshot.notes.map((note) => [note.id, note.relativePath]))
  const connections = snapshot.links.map((link) => `${paths.get(link.source)} -> ${paths.get(link.target)}`).sort()
  expect(connections).toEqual([
    'clientes/Caso uno.md -> inicio.md',
    'inicio.md -> agenda.markdown',
    'inicio.md -> clientes/Caso uno.md'
  ])
  expect(snapshot.notes).toHaveLength(4)
})

test('navegar entre notas respeta Cancelar, Descartar y Guardar', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('cambios')
  await writeNotes(root, { 'a.md': '# Original A\n', 'b.md': '# Original B\n' })
  await selectNotebook(application, page, root)
  expect(await openNote(page, 'a.md')).toEqual({ status: 'ok' })
  const editor = page.getByRole('textbox', { name: 'Documento Markdown' })
  await editor.fill('Cambio que se cancela')
  await chooseChanges(application, 2)
  expect(await openNote(page, 'b.md')).toEqual({ status: 'cancelled' })
  await expect(editor).toHaveText('Cambio que se cancela')
  expect((await page.evaluate(() => window.documents.current())).name).toBe('a.md')
  await chooseChanges(application, 1)
  expect(await openNote(page, 'b.md')).toEqual({ status: 'ok' })
  await expect(editor.locator('h1')).toHaveText('Original B')
  expect(await fs.readFile(join(root, 'a.md'), 'utf8')).toBe('# Original A\n')
  await editor.fill('Cambio que se guarda')
  await chooseChanges(application, 0)
  expect(await openNote(page, 'a.md')).toEqual({ status: 'ok' })
  await expect(editor.locator('h1')).toHaveText('Original A')
  expect(await fs.readFile(join(root, 'b.md'), 'utf8')).toContain('Cambio que se guarda')
})

test('cambiar cuaderno confirma cambios y aísla notas e identificadores', async ({ application, editorPage: page }, testInfo) => {
  const firstRoot = testInfo.outputPath('primero')
  const secondRoot = testInfo.outputPath('segundo')
  await writeNotes(firstRoot, { 'nota.md': '# Primero\n' })
  await writeNotes(secondRoot, { 'nota.md': '# Segundo\n' })
  const first = await selectNotebook(application, page, firstRoot)
  expect(await openNote(page, 'nota.md')).toEqual({ status: 'ok' })
  const editor = page.getByRole('textbox', { name: 'Documento Markdown' })
  await editor.fill('Pendiente en primero')
  await chooseOpen(application, secondRoot)
  await chooseChanges(application, 2)
  expect(await page.evaluate(() => window.workspace.choose())).toEqual({ status: 'cancelled' })
  expect((await page.evaluate(() => window.workspace.current()))?.id).toBe(first.id)
  await expect(editor).toHaveText('Pendiente en primero')
  await chooseChanges(application, 1)
  const second = await selectNotebook(application, page, secondRoot)
  expect(second.id).not.toBe(first.id)
  expect(second.notes).toHaveLength(1)
  expect(second.notes[0].id).not.toBe(first.notes[0].id)
  expect(second.currentNoteId).toBeNull()
  await expect(editor).toHaveText('')
  expect((await page.evaluate((id) => window.workspace.open(id), first.notes[0].id)).status).toBe('error')
  expect(await openNote(page, 'nota.md')).toEqual({ status: 'ok' })
  await expect(editor.locator('h1')).toHaveText('Segundo')
  expect(await fs.readFile(join(firstRoot, 'nota.md'), 'utf8')).toBe('# Primero\n')
})

test('actualizar incorpora altas y bajas sin perder la edición de la nota actual', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('actualizar')
  await writeNotes(root, { 'actual.md': '# Actual\n', 'eliminada.md': '# Eliminada\n' })
  const before = await selectNotebook(application, page, root)
  expect(await openNote(page, 'actual.md')).toEqual({ status: 'ok' })
  const editor = page.getByRole('textbox', { name: 'Documento Markdown' })
  await editor.fill('Edición pendiente conservada')
  await fs.unlink(join(root, 'eliminada.md'))
  await writeNotes(root, { 'nueva.md': '# Nueva\n\n[Actual](actual.md)\n' })
  expect(await page.evaluate(() => window.workspace.refresh())).toEqual({ status: 'ok' })
  const after = await page.evaluate(() => window.workspace.current())
  expect(after?.notes.map((note) => note.relativePath).sort()).toEqual(['actual.md', 'nueva.md'])
  const currentId = before.notes.find((note) => note.relativePath === 'actual.md')!.id
  expect(after?.currentNoteId).toBe(currentId)
  expect(after?.notes.find((note) => note.relativePath === 'actual.md')?.id).toBe(currentId)
  expect(after?.links).toEqual([{ source: after?.notes.find((note) => note.relativePath === 'nueva.md')?.id, target: currentId }])
  await expect(editor).toHaveText('Edición pendiente conservada')
  expect((await page.evaluate(() => window.documents.current())).dirty).toBe(true)
  const removedId = before.notes.find((note) => note.relativePath === 'eliminada.md')!.id
  expect((await page.evaluate((id) => window.workspace.open(id), removedId)).status).toBe('error')
})

test('cuaderno rechaza rutas como IDs y evita junctions incluso tras indexar', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('seguridad')
  const outside = testInfo.outputPath('externo')
  await writeNotes(root, { 'segura.md': '# Segura\n', 'sub/nota.md': '# Interior\n' })
  await writeNotes(outside, { 'nota.md': '# Secreto exterior\n' })
  await fs.symlink(outside, join(root, 'enlace'), 'junction')
  const snapshot = await selectNotebook(application, page, root)
  expect(snapshot.notes.map((note) => note.relativePath).sort()).toEqual(['segura.md', 'sub/nota.md'])
  expect(await openNote(page, 'segura.md')).toEqual({ status: 'ok' })
  for (const id of ['no-existe', '../externo/nota.md', '%2e%2e/externo/nota.md', join(outside, 'nota.md')]) {
    expect((await page.evaluate((value) => window.workspace.open(value), id)).status).toBe('error')
  }
  const replacedId = snapshot.notes.find((note) => note.relativePath === 'sub/nota.md')!.id
  await fs.unlink(join(root, 'sub', 'nota.md'))
  await fs.rmdir(join(root, 'sub'))
  await fs.symlink(outside, join(root, 'sub'), 'junction')
  expect((await page.evaluate((id) => window.workspace.open(id), replacedId)).status).toBe('error')
  await expect(page.getByRole('textbox', { name: 'Documento Markdown' }).locator('h1')).toHaveText('Segura')
  expect((await page.evaluate(() => window.documents.current())).content).not.toContain('Secreto exterior')
})

test('abrir un Markdown independiente establece su carpeta como cuaderno', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('independiente')
  await writeNotes(root, { 'elegida.md': '# Elegida\n', 'vecina.markdown': '# Vecina\n' })
  await chooseOpen(application, join(root, 'elegida.md'))
  await page.getByRole('button', { name: 'Abrir', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Documento Markdown' }).locator('h1')).toHaveText('Elegida')
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled()
  const snapshot = await page.evaluate(() => window.workspace.current())
  expect(snapshot?.notes.map((note) => note.relativePath).sort()).toEqual(['elegida.md', 'vecina.markdown'])
  expect(snapshot?.currentNoteId).toBe(snapshot?.notes.find((note) => note.relativePath === 'elegida.md')?.id)
})

test('guardar rechaza una subcarpeta sustituida por junction y conserva los cambios', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('guardar-seguro')
  const outside = testInfo.outputPath('guardar-exterior')
  const original = '# Original\n'
  await writeNotes(root, { 'sub/a.md': original })
  await writeNotes(outside, { 'a.md': original })
  await selectNotebook(application, page, root)
  expect(await openNote(page, 'sub/a.md')).toEqual({ status: 'ok' })
  await fs.unlink(join(root, 'sub', 'a.md'))
  await fs.rmdir(join(root, 'sub'))
  await fs.symlink(outside, join(root, 'sub'), 'junction')
  const editor = page.getByRole('textbox', { name: 'Documento Markdown' })
  await editor.fill('Cambio local que debe conservarse')
  const result = await page.evaluate(() => window.documents.save(false))
  expect(result.status).toBe('error')
  expect(await fs.readFile(join(outside, 'a.md'), 'utf8')).toBe(original)
  const current = await page.evaluate(() => window.documents.current())
  expect(current.dirty).toBe(true)
  expect(current.content).toContain('Cambio local que debe conservarse')
  await expect(editor).toHaveText('Cambio local que debe conservarse')
})

test('barra plegable y Cerebro permiten navegar con teclado también a notas aisladas', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('cerebro')
  await writeNotes(root, {
    'a.md': '# Nota A\n\n[Nota B](b.md)\n',
    'b.md': '# Nota B\n',
    'aislada.md': '# Nota aislada\n'
  })
  const sidebar = page.getByRole('complementary', { name: 'Notas del cuaderno' })
  await expect(sidebar).not.toBeVisible()
  const show = page.getByRole('button', { name: 'Mostrar cuaderno', exact: true })
  await show.focus()
  await page.keyboard.press('Enter')
  await expect(sidebar).toBeVisible()
  await selectNotebook(application, page, root)
  expect(await openNote(page, 'a.md')).toEqual({ status: 'ok' })
  const brainButton = sidebar.getByRole('button', { name: 'Cerebro', exact: true })
  await brainButton.focus()
  await page.keyboard.press('Enter')
  const brain = page.getByRole('region', { name: 'Conexiones del cuaderno' })
  await expect(brain).toBeVisible()
  await expect(brain.locator('canvas').first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('cuaderno-cerebro.png') })
  await expect(brain.getByText('Notas y conexiones', { exact: true })).toBeVisible()
  await expect(brain.getByRole('button', { name: 'Vista previa:', exact: false })).toHaveCount(3)
  const isolated = brain.getByRole('button', { name: 'Vista previa: aislada.md', exact: true })
  await isolated.focus()
  await page.keyboard.press('Enter')
  const preview = brain.getByRole('region', { name: 'Vista previa de nota' })
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('# Nota aislada')
  await preview.getByRole('button', { name: 'Abrir nota', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Documento Markdown' }).locator('h1')).toHaveText('Nota aislada')
  const hide = page.getByRole('button', { name: 'Ocultar cuaderno', exact: true })
  await hide.focus()
  await page.keyboard.press('Enter')
  await expect(sidebar).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Mostrar cuaderno', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Documento Markdown' }).locator('h1')).toHaveText('Nota aislada')
  const nativeWindow = await application.browserWindow(page)
  await nativeWindow.evaluate((window) => window.setSize(420, 700))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(420)
  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  await expect(sidebar).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const bounds = await sidebar.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  await page.screenshot({ path: testInfo.outputPath('cuaderno-420.png') })
  await sidebar.getByRole('searchbox', { name: 'Buscar notas' }).focus()
  await page.keyboard.press('Escape')
  await expect(sidebar).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Mostrar cuaderno', exact: true })).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByRole('textbox', { name: 'Documento Markdown' }).locator('h1')).toHaveText('Nota aislada')
})

test('drawer estrecho contiene el foco y abrir notas mantiene el modo Markdown y los errores visibles', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('drawer-markdown')
  await writeNotes(root, { 'a.md': '# Nota A\n', 'b.md': '# Nota B\n', 'borrada.md': '# Desaparecida\n' })
  await selectNotebook(application, page, root)
  expect(await openNote(page, 'a.md')).toEqual({ status: 'ok' })
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  const source = page.locator('textarea[aria-label="Código Markdown"]')
  const nativeWindow = await application.browserWindow(page)
  await nativeWindow.evaluate((window) => window.setSize(420, 700))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(420)
  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  const sidebar = page.getByRole('complementary', { name: 'Notas del cuaderno' })
  await expect(sidebar.getByRole('searchbox', { name: 'Buscar notas' })).toBeFocused()
  expect(await source.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true)
  const controlCount = await sidebar.locator('button:not(:disabled), input:not(:disabled)').count()
  for (let index = 0; index < controlCount + 2; index++) {
    await page.keyboard.press('Tab')
    expect(await sidebar.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  }
  await sidebar.getByRole('button', { name: 'Cerrar panel de notas', exact: true }).focus()
  await page.keyboard.press('Shift+Tab')
  await expect(sidebar.getByRole('button', { name: 'Abrir nota: borrada.md', exact: true })).toBeFocused()
  await sidebar.getByRole('button', { name: 'Abrir nota: b.md', exact: true }).click()
  await expect(sidebar).not.toBeVisible()
  await expect(source).toHaveValue('# Nota B\n')
  await expect(source).toBeFocused()
  await expect(page.getByRole('button', { name: 'Markdown', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await source.fill('# Nota B\n\nEdición pendiente conservada.\n')
  await fs.unlink(join(root, 'borrada.md'))
  await chooseChanges(application, 1)
  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  await sidebar.getByRole('button', { name: 'Abrir nota: borrada.md', exact: true }).click()
  await expect(sidebar).not.toBeVisible()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(/no existe|ENOENT/)
  await expect(source).toHaveValue('# Nota B\n\nEdición pendiente conservada.\n')
  expect((await page.evaluate(() => window.documents.current())).dirty).toBe(true)
  expect(await fs.readFile(join(root, 'b.md'), 'utf8')).toBe('# Nota B\n')
})

test('Cerebro refleja enlaces guardados y conserva la fuente pendiente y la raíz del cuaderno', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('enlaces-guardados')
  const original = '# Nota\n\n[B](../b.md)\n'
  const edited = '# Nota editada\n\n[C](../c.md#detalle)\n'
  await writeNotes(root, { 'sub/nota.md': original, 'b.md': '# B\n', 'c.md': '# C\n' })
  const initial = await selectNotebook(application, page, root)
  expect(await openNote(page, 'sub/nota.md')).toEqual({ status: 'ok' })
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Código Markdown', exact: true })
  await source.fill(edited)
  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  await page.getByRole('button', { name: 'Cerebro', exact: true }).click()
  const brain = page.getByRole('region', { name: 'Conexiones del cuaderno' })
  await expect(brain).toBeVisible()
  await expect(brain.getByRole('button', { name: 'Vista previa de conexión de sub/nota.md a b.md', exact: true })).toBeVisible()
  await expect(brain.getByRole('button', { name: 'Vista previa de conexión de sub/nota.md a c.md', exact: true })).toHaveCount(0)
  expect(await fs.readFile(join(root, 'sub', 'nota.md'), 'utf8')).toBe(original)
  await brain.getByRole('button', { name: 'Volver al documento', exact: true }).click()
  await expect(source).toHaveValue(edited)
  await expect(source).toBeFocused()
  expect((await page.evaluate(() => window.documents.current())).dirty).toBe(true)
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Guardado')
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled()
  const after = await page.evaluate(() => window.workspace.current())
  const noteId = initial.notes.find((note) => note.relativePath === 'sub/nota.md')!.id
  const targetId = initial.notes.find((note) => note.relativePath === 'c.md')!.id
  expect(after?.id).toBe(initial.id)
  expect(after?.notes.map((note) => note.relativePath).sort()).toEqual(['b.md', 'c.md', 'sub/nota.md'])
  expect(after?.currentNoteId).toBe(noteId)
  expect(after?.links).toEqual([{ source: noteId, target: targetId }])
  expect(await fs.readFile(join(root, 'sub', 'nota.md'), 'utf8')).toBe(edited)
  await page.getByRole('button', { name: 'Cerebro', exact: true }).click()
  await expect(brain.getByRole('button', { name: 'Vista previa de conexión de sub/nota.md a c.md', exact: true })).toBeVisible()
  await expect(brain.getByRole('button', { name: 'Vista previa de conexión de sub/nota.md a b.md', exact: true })).toHaveCount(0)
})

test('árbol de notas pliega carpetas y la búsqueda muestra los ancestros de sus resultados', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('arbol')
  await writeNotes(root, {
    'inicio.md': '# Inicio\n',
    'clientes/2026/Caso especial.md': '# Caso especial\n',
    'clientes/otro.md': '# Otro\n',
    'archivo/cerrado.md': '# Cerrado\n'
  })
  await selectNotebook(application, page, root)
  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  const sidebar = page.getByRole('complementary', { name: 'Notas del cuaderno' })
  const clients = sidebar.getByRole('button', { name: 'Carpeta: clientes', exact: true })
  const year = sidebar.getByRole('button', { name: 'Carpeta: clientes/2026', exact: true })
  const special = sidebar.getByRole('button', { name: 'Abrir nota: clientes/2026/Caso especial.md', exact: true })
  await expect(clients).toHaveAttribute('aria-expanded', 'true')
  await expect(year).toHaveAttribute('aria-expanded', 'true')
  await expect(special).toBeVisible()
  const rowBounds = await special.boundingBox()
  expect(rowBounds!.height).toBeLessThanOrEqual(28)
  const iconBounds = await special.locator('svg').first().boundingBox()
  expect(iconBounds!.width).toBeLessThanOrEqual(14)
  expect(iconBounds!.height).toBeLessThanOrEqual(14)
  await clients.click()
  await expect(clients).toHaveAttribute('aria-expanded', 'false')
  await expect(special).not.toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Abrir nota: inicio.md', exact: true })).toBeVisible()
  await sidebar.getByRole('searchbox', { name: 'Buscar notas' }).fill('especial')
  await expect(clients).toBeVisible()
  await expect(year).toBeVisible()
  await expect(special).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Abrir nota:', exact: false })).toHaveCount(1)
  await expect(sidebar.getByRole('button', { name: 'Carpeta: archivo', exact: true })).not.toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('cuaderno-arbol-busqueda.png') })
  await special.click()
  await expect(page.getByRole('textbox', { name: 'Documento Markdown' }).locator('h1')).toHaveText('Caso especial')
})

test('vista previa es de solo lectura, conserva cambios y solo Abrir nota confirma la navegación', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('vista-previa')
  await writeNotes(root, { 'a.md': '# A\n', 'b.md': '# B\n\nContenido de la vista previa.\n' })
  await selectNotebook(application, page, root)
  expect(await openNote(page, 'a.md')).toEqual({ status: 'ok' })
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Código Markdown', exact: true })
  await source.fill('# A\n\nEdición sin guardar.\n')
  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  await page.getByRole('button', { name: 'Cerebro', exact: true }).click()
  const brain = page.getByRole('region', { name: 'Conexiones del cuaderno' })
  await expect(brain).toBeVisible()
  const before = await page.evaluate(() => window.documents.current())
  const currentId = (await page.evaluate(() => window.workspace.current()))?.currentNoteId
  expect(before.dirty).toBe(true)
  await application.evaluate(({ dialog }) => {
    let prompts = 0
    dialog.showMessageBox = Object.assign(async () => {
      prompts++
      return { response: 2, checkboxChecked: false }
    }, { prompts: () => prompts })
  })
  await brain.getByRole('button', { name: 'Vista previa: b.md', exact: true }).click()
  const preview = brain.getByRole('region', { name: 'Vista previa de nota' })
  await expect(preview).toContainText('# B')
  await expect(preview).toContainText('Contenido de la vista previa.')
  await expect(preview.locator('[contenteditable="true"], textarea:not([readonly]), input:not([readonly])')).toHaveCount(0)
  expect(await page.evaluate(() => window.documents.current())).toEqual(before)
  expect((await page.evaluate(() => window.workspace.current()))?.currentNoteId).toBe(currentId)
  expect(await application.evaluate(({ dialog }) => (dialog.showMessageBox as typeof dialog.showMessageBox & { prompts(): number }).prompts())).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('cuaderno-vista-previa.png') })
  await preview.getByRole('button', { name: 'Cerrar vista previa', exact: true }).click()
  await expect(preview).not.toBeVisible()
  await brain.getByRole('button', { name: 'Vista previa: b.md', exact: true }).click()
  await preview.getByRole('button', { name: 'Abrir nota', exact: true }).click()
  await expect.poll(() => application.evaluate(({ dialog }) => (dialog.showMessageBox as typeof dialog.showMessageBox & { prompts(): number }).prompts())).toBe(1)
  await expect(brain).toBeVisible()
  expect(await page.evaluate(() => window.documents.current())).toEqual(before)
  await chooseChanges(application, 1)
  await preview.getByRole('button', { name: 'Abrir nota', exact: true }).click()
  await expect(brain).not.toBeVisible()
  await expect(source).toHaveValue('# B\n\nContenido de la vista previa.\n')
  expect(await fs.readFile(join(root, 'a.md'), 'utf8')).toBe('# A\n')
})

test('vista previa rechaza IDs de otro cuaderno, rutas y junctions sin cambiar el documento', async ({ application, editorPage: page }, testInfo) => {
  const firstRoot = testInfo.outputPath('preview-primero')
  const root = testInfo.outputPath('preview-segundo')
  const outside = testInfo.outputPath('preview-exterior')
  await writeNotes(firstRoot, { 'a.md': '# Primero\n' })
  await writeNotes(root, { 'segura.md': '# Segura\n', 'sub/nota.md': '# Interior\n' })
  await writeNotes(outside, { 'nota.md': '# Secreto exterior\n' })
  const first = await selectNotebook(application, page, firstRoot)
  const snapshot = await selectNotebook(application, page, root)
  expect(await openNote(page, 'segura.md')).toEqual({ status: 'ok' })
  const before = await page.evaluate(() => window.documents.current())
  const safe = snapshot.notes.find((note) => note.relativePath === 'segura.md')!
  expect(await page.evaluate((id) => window.workspace.preview(id), safe.id)).toEqual({ status: 'ok', note: safe, content: '# Segura\n' })
  for (const id of [first.notes[0].id, 'no-existe', '../preview-exterior/nota.md', '%2e%2e/preview-exterior/nota.md', join(outside, 'nota.md')]) {
    expect((await page.evaluate((value) => window.workspace.preview(value), id)).status).toBe('error')
  }
  const replacedId = snapshot.notes.find((note) => note.relativePath === 'sub/nota.md')!.id
  await fs.unlink(join(root, 'sub', 'nota.md'))
  await fs.rmdir(join(root, 'sub'))
  await fs.symlink(outside, join(root, 'sub'), 'junction')
  const rejected = await page.evaluate((id) => window.workspace.preview(id), replacedId)
  expect(rejected.status).toBe('error')
  expect(JSON.stringify(rejected)).not.toContain('Secreto exterior')
  expect(await page.evaluate(() => window.documents.current())).toEqual(before)
  expect((await page.evaluate(() => window.workspace.current()))?.currentNoteId).toBe(safe.id)
})

test('nodo del grafo muestra información al pasar el puntero y su clic abre solo vista previa', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('hover-grafo')
  await writeNotes(root, { 'sola.md': '# Nota para previsualizar\n' })
  const snapshot = await selectNotebook(application, page, root)
  const before = await page.evaluate(() => window.documents.current())
  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  await page.getByRole('button', { name: 'Cerebro', exact: true }).click()
  const brain = page.getByRole('region', { name: 'Conexiones del cuaderno' })
  const canvas = brain.getByTestId('brain-canvas')
  await expect(canvas.locator('canvas').first()).toBeVisible()
  const nodePoint = () => canvas.evaluate((element, id) => {
    // The fitted bounds include the label, so the node is not necessarily at the canvas center.
    const graph = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
    const position = graph.getElementById(id).renderedPosition()
    const bounds = element.getBoundingClientRect()
    return { x: bounds.x + position.x, y: bounds.y + position.y }
  }, snapshot.notes[0].id)
  await page.screenshot({ path: testInfo.outputPath('cuaderno-nodo-normal.png') })
  const hoverPoint = await nodePoint()
  await page.mouse.move(hoverPoint.x, hoverPoint.y)
  await expect(brain.getByRole('button', { name: 'Información de nota: sola.md', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('cuaderno-nodo-hover.png') })
  const clickPoint = await nodePoint()
  await page.mouse.click(clickPoint.x, clickPoint.y)
  await expect(brain.getByRole('region', { name: 'Vista previa de nota' })).toContainText('# Nota para previsualizar')
  expect(await page.evaluate(() => window.documents.current())).toEqual(before)
  expect((await page.evaluate(() => window.workspace.current()))?.currentNoteId).toBeNull()
})
