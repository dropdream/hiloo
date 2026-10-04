import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, chooseOpen } from './fixtures'

async function notebook(application: ElectronApplication, page: Page, root: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name)
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, content)
  }
  await chooseOpen(application, root)
  expect(await page.evaluate(() => window.workspace.choose())).toEqual({ status: 'ok' })
  return (await page.evaluate(() => window.workspace.current()))!
}

test('selector distingue homónimos, busca sin tildes e inserta un enlace persistente conservando la selección', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('selector-notas')
  const snapshot = await notebook(application, page, root, {
    'origen.md': 'Texto seleccionado\n',
    'clientes/Árbol.md': '# Cliente\n',
    'archivo/Árbol.md': '# Archivo\n',
    'otra.md': '# Otra\n'
  })
  const origin = snapshot.notes.find((note) => note.relativePath === 'origen.md')!
  const target = snapshot.notes.find((note) => note.relativePath === 'clientes/Árbol.md')!
  expect(await page.evaluate((id) => window.workspace.open(id), origin.id)).toEqual({ status: 'ok' })
  const editor = page.getByRole('textbox', { name: 'Documento Markdown', exact: true })
  await editor.press('Control+A')
  await page.getByRole('button', { name: 'Enlace', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Insertar enlace', exact: true })
  await expect(dialog.getByRole('radio', { name: 'Nota del cuaderno', exact: true })).toBeChecked()
  await expect(dialog.getByRole('radio', { name: 'Enlazar nota: origen.md', exact: true })).toHaveCount(0)
  const search = dialog.getByRole('searchbox', { name: 'Buscar nota para enlazar', exact: true })
  await search.fill('arbol')
  await expect(dialog.getByRole('radio', { name: 'Enlazar nota:', exact: false })).toHaveCount(2)
  await expect(dialog.getByRole('radio', { name: 'Enlazar nota: archivo/Árbol.md', exact: true })).toBeVisible()
  await search.fill('clientes/arbol')
  await expect(dialog.getByRole('radio', { name: 'Enlazar nota:', exact: false })).toHaveCount(1)
  await dialog.getByRole('radio', { name: 'Enlazar nota: clientes/Árbol.md', exact: true }).check()
  await dialog.getByRole('button', { name: 'Insertar', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(editor.locator('a')).toHaveText('Texto seleccionado')
  await expect(editor.locator('a')).toHaveAttribute('href', 'clientes/%C3%81rbol.md')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Guardado')
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled()
  expect(await fs.readFile(join(root, 'origen.md'), 'utf8')).toContain('[Texto seleccionado](clientes/%C3%81rbol.md)')
  expect((await page.evaluate(() => window.workspace.current()))!.links).toEqual([{ source: origin.id, target: target.id }])
  expect(await page.evaluate((id) => window.workspace.open(id), origin.id)).toEqual({ status: 'ok' })
  await expect(editor.locator('a')).toHaveText('Texto seleccionado')
  await expect(editor.locator('a')).toHaveAttribute('href', 'clientes/%C3%81rbol.md')
})

test('insertar en un cursor vacío usa un nombre legible y cancelar conserva el documento', async ({ application, editorPage: page }, testInfo) => {
  const snapshot = await notebook(application, page, testInfo.outputPath('cursor-vacio'), {
    'origen.md': '',
    'Árbol de ideas.markdown': '# Ideas\n'
  })
  const origin = snapshot.notes.find((note) => note.relativePath === 'origen.md')!
  expect(await page.evaluate((id) => window.workspace.open(id), origin.id)).toEqual({ status: 'ok' })
  const before = await page.evaluate(() => window.documents.current())
  const editor = page.getByRole('textbox', { name: 'Documento Markdown', exact: true })
  await editor.click()
  await page.getByRole('button', { name: 'Enlace', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Insertar enlace', exact: true })
  await dialog.getByRole('radio', { name: 'Enlazar nota: Árbol de ideas.markdown', exact: true }).check()
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(editor).toBeFocused()
  expect(await page.evaluate(() => window.documents.current())).toEqual(before)
  await page.getByRole('button', { name: 'Enlace', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Insertar enlace', exact: true })
  await dialog.getByRole('radio', { name: 'Enlazar nota: Árbol de ideas.markdown', exact: true }).check()
  await dialog.getByRole('button', { name: 'Insertar', exact: true }).click()
  await expect(editor.locator('a')).toHaveText('Árbol de ideas')
  await expect(editor.locator('a')).toHaveAttribute('href', '%C3%81rbol%20de%20ideas.markdown')
})

test('editar un enlace conserva su dirección hasta elegir explícitamente otra nota', async ({ application, editorPage: page }, testInfo) => {
  const snapshot = await notebook(application, page, testInfo.outputPath('editar-enlace'), {
    'origen.md': '[Referencia](https://example.com/ruta?q=1#detalle)\n',
    'destino.md': '# Destino\n'
  })
  const origin = snapshot.notes.find((note) => note.relativePath === 'origen.md')!
  expect(await page.evaluate((id) => window.workspace.open(id), origin.id)).toEqual({ status: 'ok' })
  const editor = page.getByRole('textbox', { name: 'Documento Markdown', exact: true })
  await editor.locator('a').click()
  await page.getByRole('button', { name: 'Enlace', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Editar enlace', exact: true })
  await expect(dialog.getByRole('radio', { name: 'Dirección web o manual', exact: true })).toBeChecked()
  await expect(dialog.getByLabel('Dirección', { exact: true })).toHaveValue('https://example.com/ruta?q=1#detalle')
  await dialog.getByRole('button', { name: 'Aplicar', exact: true }).click()
  await expect(editor.locator('a')).toHaveAttribute('href', 'https://example.com/ruta?q=1#detalle')
  await editor.locator('a').click()
  await page.getByRole('button', { name: 'Enlace', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Editar enlace', exact: true })
  await dialog.getByRole('radio', { name: 'Nota del cuaderno', exact: true }).check()
  await dialog.getByRole('radio', { name: 'Enlazar nota: destino.md', exact: true }).check()
  await dialog.getByRole('button', { name: 'Aplicar', exact: true }).click()
  await expect(editor.locator('a')).toHaveText('Referencia')
  await expect(editor.locator('a')).toHaveAttribute('href', 'destino.md')
})

test('linkTo calcula rutas relativas codificadas sin cambiar la nota editada', async ({ application, editorPage: page }, testInfo) => {
  const snapshot = await notebook(application, page, testInfo.outputPath('rutas-especiales'), {
    'sub/origen.md': '# Origen\n',
    'Especial #%/Árbol #1%.md': '# Destino\n'
  })
  const origin = snapshot.notes.find((note) => note.relativePath === 'sub/origen.md')!
  const target = snapshot.notes.find((note) => note.relativePath === 'Especial #%/Árbol #1%.md')!
  expect(await page.evaluate((id) => window.workspace.open(id), origin.id)).toEqual({ status: 'ok' })
  const before = await page.evaluate(() => window.documents.current())
  expect(await page.evaluate((id) => window.workspace.linkTo(id), target.id)).toEqual({ status: 'ok', note: target, href: '../Especial%20%23%25/%C3%81rbol%20%231%25.md' })
  expect(await page.evaluate(() => window.documents.current())).toEqual(before)
  expect((await page.evaluate(() => window.workspace.current()))!.currentNoteId).toBe(origin.id)
})

test('linkTo rechaza origen sin guardar, IDs ajenos, notas borradas y junctions en ambos extremos', async ({ application, editorPage: page }, testInfo) => {
  const first = await notebook(application, page, testInfo.outputPath('primer-cuaderno'), { 'ajena.md': '# Ajena\n' })
  const root = testInfo.outputPath('segundo-cuaderno')
  const snapshot = await notebook(application, page, root, {
    'origen/origen.md': '# Origen\n',
    'destino/nota.md': '# Interior\n',
    'borrada.md': '# Borrada\n',
    'segura.md': '# Segura\n'
  })
  const origin = snapshot.notes.find((note) => note.relativePath === 'origen/origen.md')!
  const target = snapshot.notes.find((note) => note.relativePath === 'destino/nota.md')!
  const deleted = snapshot.notes.find((note) => note.relativePath === 'borrada.md')!
  const safe = snapshot.notes.find((note) => note.relativePath === 'segura.md')!
  expect((await page.evaluate((id) => window.workspace.linkTo(id), target.id)).status).toBe('error')
  expect(await page.evaluate((id) => window.workspace.open(id), origin.id)).toEqual({ status: 'ok' })
  const before = await page.evaluate(() => window.documents.current())
  for (const id of [origin.id, first.notes[0].id, '../borrada.md', join(root, 'segura.md')]) {
    expect((await page.evaluate((value) => window.workspace.linkTo(value), id)).status).toBe('error')
  }
  await fs.unlink(join(root, 'borrada.md'))
  expect((await page.evaluate((id) => window.workspace.linkTo(id), deleted.id)).status).toBe('error')
  const outside = testInfo.outputPath('exterior')
  await fs.mkdir(outside, { recursive: true })
  await fs.writeFile(join(outside, 'nota.md'), '# Exterior\n')
  await fs.writeFile(join(outside, 'origen.md'), '# Origen\n')
  await fs.unlink(join(root, 'destino', 'nota.md'))
  await fs.rmdir(join(root, 'destino'))
  await fs.symlink(outside, join(root, 'destino'), 'junction')
  expect((await page.evaluate((id) => window.workspace.linkTo(id), target.id)).status).toBe('error')
  await fs.unlink(join(root, 'origen', 'origen.md'))
  await fs.rmdir(join(root, 'origen'))
  await fs.symlink(outside, join(root, 'origen'), 'junction')
  expect((await page.evaluate((id) => window.workspace.linkTo(id), safe.id)).status).toBe('error')
  expect(await page.evaluate(() => window.documents.current())).toEqual(before)
})

test('selector a 420px funciona con teclado y cancelar no altera el contenido', async ({ application, editorPage: page }, testInfo) => {
  const snapshot = await notebook(application, page, testInfo.outputPath('selector-estrecho'), {
    'origen.md': 'Referencia\n',
    'subcarpeta de documentación/Documento con nombre largo.md': '# Destino\n'
  })
  const origin = snapshot.notes.find((note) => note.relativePath === 'origen.md')!
  expect(await page.evaluate((id) => window.workspace.open(id), origin.id)).toEqual({ status: 'ok' })
  const before = await page.evaluate(() => window.documents.current())
  const nativeWindow = await application.browserWindow(page)
  await nativeWindow.evaluate((window) => window.setSize(420, 700))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(420)
  const editor = page.getByRole('textbox', { name: 'Documento Markdown', exact: true })
  await editor.press('Control+A')
  await page.getByRole('button', { name: 'Enlace', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Insertar enlace', exact: true })
  const search = dialog.getByRole('searchbox', { name: 'Buscar nota para enlazar', exact: true })
  await search.fill('documentacion')
  const option = dialog.getByRole('radio', { name: 'Enlazar nota: subcarpeta de documentación/Documento con nombre largo.md', exact: true })
  await option.focus()
  await page.keyboard.press('Space')
  await expect(option).toBeChecked()
  await page.keyboard.press('Tab')
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('selector-enlace-420.png') })
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(editor).toBeFocused()
  expect(await page.evaluate(() => window.documents.current())).toEqual(before)
})
