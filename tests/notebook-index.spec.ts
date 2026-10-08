import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, chooseOpen } from './fixtures'
import { markdownProblem } from '../src/shared/markdown'
import { buildNotebookIndex, encodeNotePath, escapeMarkdownText, maxIndexedNotes, type NotebookIndexUsage } from '../src/shared/notebook-index'

async function writeNotes(root: string, notes: Record<string, string>) {
  await fs.mkdir(root, { recursive: true })
  for (const [relativePath, content] of Object.entries(notes)) {
    const path = join(root, relativePath)
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, content)
  }
}

async function chooseFromSidebar(application: ElectronApplication, page: Page, root: string) {
  await chooseOpen(application, root)
  const sidebar = page.getByRole('complementary', { name: 'Notas del cuaderno' })
  if (!await sidebar.isVisible()) await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  const trigger = sidebar.getByRole('button', { name: /^(Abrir|Cambiar) cuaderno$/ })
  await trigger.click()
  await expect.poll(() => page.evaluate(() => window.workspace.current().then((workspace) => workspace?.name))).toBe(root.split(/[\\/]/).at(-1))
  return sidebar
}

const indexDialog = (page: Page) => page.getByRole('dialog', { name: '¿Qué uso le darás al cuaderno?' })

test('las plantillas del índice son Markdown compatible con enlaces codificados', () => {
  const notes = ['agenda.md', 'clientes/Caso uno.md', 'raros/a(b) #1 & 50%_x.markdown']
  const expected: Record<NotebookIndexUsage, string[]> = {
    ia: ['# Índice — Proyecto', '## Instrucciones para IA', '## Mapa de notas'],
    humano: ['# Proyecto', '## Introducción', '## Secciones', '### Objetivos', '## Notas'],
    ambos: ['# Proyecto', '## Instrucciones para IA', '## Introducción', '## Secciones', '## Mapa de notas']
  }
  for (const usage of ['ia', 'humano', 'ambos'] as const) {
    const content = buildNotebookIndex({ name: 'Proyecto', usage, date: '2026-10-05', notes })
    expect(markdownProblem(content), usage).toBeNull()
    const headings = content.split('\n').filter((line) => line.startsWith('#'))
    expect(headings.filter((line) => expected[usage].includes(line)), usage).toEqual(expected[usage])
    expect(content.startsWith(expected[usage][0] + '\n'), usage).toBe(true)
    expect(content).toContain('- [agenda](agenda.md)')
    expect(content).toContain('- [clientes/Caso uno](clientes/Caso%20uno.md)')
    expect(content).toContain('- [raros/a(b) \\#1 \\& 50%\\_x](raros/a%28b%29%20%231%20%26%2050%25_x.markdown)')
    expect(content).toContain('2026-10-05')
    expect(content).not.toMatch(/<!--|<[a-z]/i)
    expect(content.includes('pueden completarse por la persona o por una IA a petición suya'), usage).toBe(usage === 'ambos')
    expect(content.includes('*Pendiente:'), usage).toBe(usage !== 'ia')
  }
  expect(buildNotebookIndex({ name: 'Vacío', usage: 'ia', date: '2026-10-05', notes: [] })).toContain('*Aún no hay notas en este cuaderno.*')
  const many = Array.from({ length: maxIndexedNotes + 5 }, (_, index) => `nota-${index}.md`)
  const partial = buildNotebookIndex({ name: 'Grande', usage: 'humano', date: '2026-10-05', notes: many })
  expect(partial.split('\n').filter((line) => line.startsWith('- ['))).toHaveLength(maxIndexedNotes)
  expect(partial).toContain(`se muestran ${maxIndexedNotes} de ${maxIndexedNotes + 5} notas`)
  expect(buildNotebookIndex({ name: 'Notas #', usage: 'ia', date: '2026-10-05', notes: [] }).split('\n')[0]).toBe('# Índice — Notas \\#')
  expect(escapeMarkdownText('[a]*b*')).toBe('\\[a\\]\\*b\\*')
  expect(encodeNotePath('Carpeta uno/Nota ñ.md')).toBe('Carpeta%20uno/Nota%20%C3%B1.md')
})

test('elegir un cuaderno sin índice ofrece IA, Humano y Ambos, y cada uno crea y abre indice.md', async ({ application, editorPage: page }, testInfo) => {
  const cases: { usage: string; heading: string; sections: string[] }[] = [
    { usage: 'IA', heading: 'Índice — Proyecto IA', sections: ['## Instrucciones para IA', '## Mapa de notas'] },
    { usage: 'Humano', heading: 'Proyecto Humano', sections: ['## Introducción', '## Secciones', '## Notas'] },
    { usage: 'Ambos', heading: 'Proyecto Ambos', sections: ['## Instrucciones para IA', '## Introducción', '## Secciones', '## Mapa de notas'] }
  ]
  for (const entry of cases) {
    const root = testInfo.outputPath(`Proyecto ${entry.usage}`)
    await writeNotes(root, { 'agenda.md': '# Agenda\n', 'clientes/Caso uno.md': '# Caso\n' })
    await chooseFromSidebar(application, page, root)
    const dialog = indexDialog(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'IA', exact: true })).toBeFocused()
    for (const name of ['IA', 'Humano', 'Ambos']) {
      await expect(dialog.getByRole('button', { name, exact: true })).toHaveAccessibleDescription(/.+/)
    }
    if (entry.usage === 'IA') await page.screenshot({ path: testInfo.outputPath('indice-dialogo-1000.png') })
    await dialog.getByRole('button', { name: entry.usage, exact: true }).click()
    await expect(dialog).toBeHidden()
    const content = await fs.readFile(join(root, 'indice.md'), 'utf8')
    for (const section of entry.sections) expect(content, entry.usage).toContain(`\n${section}\n`)
    expect(content).toContain('[clientes/Caso uno](clientes/Caso%20uno.md)')
    await expect(page.getByRole('textbox', { name: 'Documento Markdown' }).locator('h1')).toHaveText(entry.heading)
    expect((await page.evaluate(() => window.documents.current())).name).toBe('indice.md')
    const snapshot = (await page.evaluate(() => window.workspace.current()))!
    expect(snapshot.hasIndex).toBe(true)
    const index = snapshot.notes.find((note) => note.relativePath === 'indice.md')!
    expect(snapshot.currentNoteId).toBe(index.id)
    const paths = new Map(snapshot.notes.map((note) => [note.id, note.relativePath]))
    expect(snapshot.links.filter((link) => link.source === index.id).map((link) => paths.get(link.target)).sort()).toEqual(['agenda.md', 'clientes/Caso uno.md'])
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Documento Markdown' })).toBeFocused()
    expect((await page.evaluate(() => window.documents.current())).dirty).toBe(false)
  }
})

test('Ahora no y Escape no crean nada; cuadernos recientes también ofrecen el índice', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('Sin índice')
  await writeNotes(root, { 'nota.md': '# Nota\n' })
  const sidebar = await chooseFromSidebar(application, page, root)
  const dialog = indexDialog(page)
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Ahora no', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await fs.readdir(root)).toEqual(['nota.md'])
  await expect(sidebar.getByRole('button', { name: 'Cambiar cuaderno', exact: true })).toBeFocused()

  const other = testInfo.outputPath('Otro')
  await writeNotes(other, { 'otra.md': '# Otra\n' })
  await chooseFromSidebar(application, page, other)
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(await fs.readdir(other)).toEqual(['otra.md'])

  await sidebar.getByRole('button', { name: 'Cuadernos recientes', exact: true }).click()
  await sidebar.getByRole('button', { name: `Abrir cuaderno reciente: ${root}`, exact: true }).click()
  await expect(dialog).toBeVisible()
  const nativeWindow = await application.browserWindow(page)
  await nativeWindow.evaluate((window) => window.setSize(420, 500))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(420)
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  await page.screenshot({ path: testInfo.outputPath('indice-dialogo-420.png') })
  await dialog.getByRole('button', { name: 'Ahora no', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await fs.readdir(root)).toEqual(['nota.md'])

  // Abrir un documento suelto no ofrece crear el índice.
  const loose = testInfo.outputPath('Suelto')
  await writeNotes(loose, { 'suelta.md': '# Suelta\n' })
  await chooseOpen(application, join(loose, 'suelta.md'))
  await page.keyboard.press('Control+O')
  await expect.poll(() => page.evaluate(() => window.documents.current().then((document) => document.name))).toBe('suelta.md')
  await expect.poll(() => page.evaluate(() => window.workspace.current().then((workspace) => workspace?.name))).toBe('Suelto')
  await expect(dialog).toHaveCount(0)
  expect(await fs.readdir(loose)).toEqual(['suelta.md'])
})

test('un índice existente en la raíz evita el diálogo, sin distinguir mayúsculas', async ({ application, editorPage: page }, testInfo) => {
  for (const [folder, name] of [['con-index', 'index.md'], ['con-indice', 'INDICE.md'], ['con-tilde', 'Índice.md']]) {
    const root = testInfo.outputPath(folder)
    await writeNotes(root, { [name]: '# Original\n', 'otra.md': '# Otra\n' })
    const sidebar = await chooseFromSidebar(application, page, root)
    await expect(sidebar.getByRole('button', { name: `Abrir nota: ${name}`, exact: true })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Abriendo…' })).toHaveCount(0)
    await expect(indexDialog(page)).toHaveCount(0)
    expect((await page.evaluate(() => window.workspace.current()))!.hasIndex).toBe(true)
    expect((await fs.readdir(root)).sort()).toEqual([name, 'otra.md'].sort())
    expect(await fs.readFile(join(root, name), 'utf8')).toBe('# Original\n')
  }
  // El índice de una subcarpeta no cuenta como índice del cuaderno.
  const nested = testInfo.outputPath('anidado')
  await writeNotes(nested, { 'sub/index.md': '# Sub\n' })
  await chooseFromSidebar(application, page, nested)
  await expect(indexDialog(page)).toBeVisible()
})

test('un índice que aparece mientras el diálogo está abierto nunca se sobrescribe', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('Carrera')
  await writeNotes(root, { 'nota.md': '# Nota\n' })
  await chooseFromSidebar(application, page, root)
  const dialog = indexDialog(page)
  await expect(dialog).toBeVisible()
  await fs.writeFile(join(root, 'indice.md'), '# Escrito por otra herramienta\n')
  await dialog.getByRole('button', { name: 'Ambos', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('No se sobrescribió')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Ambos', exact: true })).toBeEnabled()
  expect(await fs.readFile(join(root, 'indice.md'), 'utf8')).toBe('# Escrito por otra herramienta\n')
  expect((await page.evaluate(() => window.documents.current())).hasFile).toBe(false)
  await dialog.getByRole('button', { name: 'Ahora no', exact: true }).click()
  await expect(dialog).toBeHidden()

  // También se rechaza la creación directa si ya existe un índice.
  const workspace = (await page.evaluate(() => window.workspace.current()))!
  await fs.rename(join(root, 'indice.md'), join(root, 'Index.md'))
  expect(await page.evaluate((id) => window.workspace.createIndex(id, 'ia'), workspace.id)).toEqual({ status: 'error', message: 'El cuaderno ya tiene un índice. No se sobrescribió.' })
  expect((await fs.readdir(root)).sort()).toEqual(['Index.md', 'nota.md'])
})

test('crear índice valida cuaderno y uso en el proceso principal', async ({ application, editorPage: page }, testInfo) => {
  expect((await page.evaluate(() => window.workspace.createIndex('sin-cuaderno', 'ia'))).status).toBe('error')
  const root = testInfo.outputPath('Validación')
  await writeNotes(root, { 'nota.md': '# Nota\n' })
  await chooseOpen(application, root)
  expect(await page.evaluate(() => window.workspace.choose())).toEqual({ status: 'ok' })
  const workspace = (await page.evaluate(() => window.workspace.current()))!
  expect(workspace.hasIndex).toBe(false)
  await expect(indexDialog(page)).toHaveCount(0)
  const attempts: [unknown, unknown][] = [
    [workspace.id, 'IA'], [workspace.id, ''], [workspace.id, 'otro'], [workspace.id, null], [workspace.id, { usage: 'ia' }], [workspace.id, ['ia']],
    ['', 'ia'], ['otro-id', 'ia'], [root, 'ia'], [null, 'ia'], [{ id: workspace.id }, 'ia']
  ]
  for (const [id, usage] of attempts) {
    const result = await page.evaluate(([id, usage]) => window.workspace.createIndex(id as string, usage as never), [id, usage] as const)
    expect(result, JSON.stringify([id, usage])).toEqual({ status: 'error', message: 'El cuaderno o el uso del índice no es válido.' })
  }
  expect(await fs.readdir(root)).toEqual(['nota.md'])
  expect(await page.evaluate((id) => window.workspace.createIndex(id, 'humano'), workspace.id)).toEqual({ status: 'ok' })
  expect(await fs.readFile(join(root, 'indice.md'), 'utf8')).toContain('## Introducción')
  expect((await page.evaluate(() => window.documents.current())).name).toBe('indice.md')
})
