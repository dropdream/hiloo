import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, chooseOpen, chooseChanges } from './fixtures'

type ShellCall = [string, string]

async function notebook(application: ElectronApplication, page: Page, root: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name)
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, content)
  }
  await chooseOpen(application, root)
  expect(await page.evaluate(() => window.workspace.choose())).toEqual({ status: 'ok' })
  const snapshot = (await page.evaluate(() => window.workspace.current()))!
  const open = async (relativePath: string) => {
    const note = snapshot.notes.find((entry) => entry.relativePath === relativePath)!
    expect(await page.evaluate((id) => window.workspace.open(id), note.id)).toEqual({ status: 'ok' })
  }
  return { snapshot, open }
}

// Sustituye shell para registrar llamadas sin abrir nada de verdad.
async function recordShell(application: ElectronApplication) {
  await application.evaluate(({ shell }) => {
    const calls: [string, string][] = []
    Object.assign(globalThis, { shellCalls: calls })
    shell.openExternal = async (url) => void calls.push(['openExternal', url])
    shell.showItemInFolder = (path) => void calls.push(['showItemInFolder', path])
    shell.openPath = async (path) => {
      calls.push(['openPath', path])
      return ''
    }
  })
}

const shellCalls = (application: ElectronApplication) =>
  application.evaluate(() => (globalThis as unknown as { shellCalls: ShellCall[] }).shellCalls)

const filler = Array.from({ length: 80 }, (_, index) => `Párrafo de relleno ${index + 1}.`).join('\n\n')

test('Ctrl+clic abre una nota relativa con espacios en una pestaña nueva; el clic simple solo edita', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('enlaces-notas')
  const { open } = await notebook(application, page, root, {
    'Proyectos/origen.md': '[Clientes](../Dominio/lista%20de%20clientes.md) y [Otra](<../Dominio/otra nota.md>)\n',
    'Dominio/lista de clientes.md': '# Lista de clientes\n',
    'Dominio/otra nota.md': '# Otra nota\n'
  })
  await open('Proyectos/origen.md')
  const editor = page.getByRole('textbox', { name: 'Documento Markdown', exact: true })
  const link = editor.getByRole('link', { name: 'Clientes', exact: true })
  await link.hover()
  await expect(page.locator('[title="Ctrl+clic para abrir"]')).toHaveCount(1)
  await link.click()
  await expect(editor.locator('h1')).toHaveCount(0)
  expect((await page.evaluate(() => window.documents.current())).name).toBe('origen.md')
  await link.click({ modifiers: ['Control'] })
  await expect(editor.locator('h1')).toHaveText('Lista de clientes')
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled()
  expect((await page.evaluate(() => window.documents.current())).name).toBe('lista de clientes.md')
  expect(application.windows()).toHaveLength(1)
  await open('Proyectos/origen.md')
  await editor.getByRole('link', { name: 'Otra', exact: true }).click({ modifiers: ['Control'] })
  await expect(editor.locator('h1')).toHaveText('Otra nota')
})

test('las anclas desplazan al encabezado en la nota actual y tras abrir otra nota', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('enlaces-anclas')
  const { open } = await notebook(application, page, root, {
    'origen.md': `[Ir al final](#sección-final-1) y [Destino](destino.md#cómo-empezar)\n\n${filler}\n\n## Sección final\n\nTexto.\n\n## Sección final\n\nÚltima.\n`,
    'destino.md': `# Destino\n\n${filler}\n\n## Cómo empezar\n\nPasos.\n`
  })
  await open('origen.md')
  const editor = page.getByRole('textbox', { name: 'Documento Markdown', exact: true })
  const headings = editor.locator('h2', { hasText: 'Sección final' })
  await expect(headings.last()).not.toBeInViewport()
  await editor.getByRole('link', { name: 'Ir al final', exact: true }).click({ modifiers: ['Control'] })
  await expect(headings.last()).toBeInViewport()
  await editor.press('Control+Home')
  await editor.getByRole('link', { name: 'Destino', exact: true }).click({ modifiers: ['Control'] })
  await expect(editor.locator('h1')).toHaveText('Destino')
  await expect(editor.locator('h2', { hasText: 'Cómo empezar' })).toBeInViewport()
})

test('los enlaces web y mailto se abren con el navegador predeterminado', async ({ application, editorPage: page }, testInfo) => {
  await recordShell(application)
  const root = testInfo.outputPath('enlaces-web')
  const { open } = await notebook(application, page, root, {
    'origen.md': '[Web](https://example.com/ruta?q=1) [Correo](mailto:hola@example.com)\n'
  })
  await open('origen.md')
  const editor = page.getByRole('textbox', { name: 'Documento Markdown', exact: true })
  await editor.getByRole('link', { name: 'Web', exact: true }).click()
  expect(await shellCalls(application)).toEqual([])
  await editor.getByRole('link', { name: 'Web', exact: true }).click({ modifiers: ['Control'] })
  await editor.getByRole('link', { name: 'Correo', exact: true }).click({ modifiers: ['Control'] })
  await expect.poll(() => shellCalls(application)).toEqual([
    ['openExternal', 'https://example.com/ruta?q=1'],
    ['openExternal', 'mailto:hola@example.com']
  ])
  expect(application.windows()).toHaveLength(1)
})

test('otros archivos locales solo se muestran en su carpeta, sin abrirlos', async ({ application, editorPage: page }, testInfo) => {
  await recordShell(application)
  const root = testInfo.outputPath('enlaces-archivos')
  await fs.mkdir(join(root, 'adjuntos', 'carpeta'), { recursive: true })
  await fs.writeFile(join(root, 'adjuntos', 'informe final.pdf'), '%PDF-1.4')
  await fs.writeFile(join(root, 'adjuntos', 'script.bat'), 'echo hola')
  const { open } = await notebook(application, page, root, {
    'origen.md': '[Informe](adjuntos/informe%20final.pdf) [Script](adjuntos/script.bat) [Carpeta](adjuntos/carpeta)\n'
  })
  await open('origen.md')
  const editor = page.getByRole('textbox', { name: 'Documento Markdown', exact: true })
  for (const name of ['Informe', 'Script', 'Carpeta'])
    await editor.getByRole('link', { name, exact: true }).click({ modifiers: ['Control'] })
  const real = await fs.realpath(root)
  await expect.poll(() => shellCalls(application)).toEqual([
    ['showItemInFolder', join(real, 'adjuntos', 'informe final.pdf')],
    ['showItemInFolder', join(real, 'adjuntos', 'script.bat')],
    ['showItemInFolder', join(real, 'adjuntos', 'carpeta')]
  ])
  expect((await page.evaluate(() => window.documents.current())).name).toBe('origen.md')
})

test('un destino inexistente muestra un aviso y conserva la nota', async ({ application, editorPage: page }, testInfo) => {
  await recordShell(application)
  const root = testInfo.outputPath('enlaces-ausentes')
  const { open } = await notebook(application, page, root, {
    'origen.md': '[Falta](no-existe.md) [Sección](#no-hay) [Archivo](falta.pdf)\n\n# Título\n'
  })
  await open('origen.md')
  const editor = page.getByRole('textbox', { name: 'Documento Markdown', exact: true })
  await editor.getByRole('link', { name: 'Falta', exact: true }).click({ modifiers: ['Control'] })
  await expect(page.getByRole('alert')).toContainText('No se encontró no-existe.md')
  await page.getByRole('button', { name: 'Cerrar aviso', exact: true }).click()
  await editor.getByRole('link', { name: 'Sección', exact: true }).click({ modifiers: ['Control'] })
  await expect(page.getByRole('alert')).toContainText('No se encontró la sección «no-hay»')
  await page.getByRole('button', { name: 'Cerrar aviso', exact: true }).click()
  await editor.getByRole('link', { name: 'Archivo', exact: true }).click({ modifiers: ['Control'] })
  await expect(page.getByRole('alert')).toContainText('No se encontró falta.pdf')
  expect(await shellCalls(application)).toEqual([])
  expect((await page.evaluate(() => window.documents.current())).name).toBe('origen.md')
})

test('un enlace abre la nota en otra pestaña sin preguntar y enfoca la pestaña si ya está abierta', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('enlaces-cambios')
  const { open } = await notebook(application, page, root, {
    'origen.md': '[Destino](destino.md) y texto\n',
    'destino.md': '# Destino\n'
  })
  await open('origen.md')
  const editor = page.getByRole('textbox', { name: 'Documento Markdown', exact: true })
  const tabs = page.getByRole('tablist', { name: 'Documentos abiertos' })
  await editor.press('Control+End')
  await page.keyboard.insertText(' cambio')
  await expect(page.getByRole('status')).toHaveText('Cambios sin guardar')
  // Cancelar en un diálogo dejaría la nota de origen: no debe mostrarse ninguno.
  await chooseChanges(application, 2)
  await editor.getByRole('link', { name: 'Destino', exact: true }).click({ modifiers: ['Control'] })
  await expect(editor.locator('h1')).toHaveText('Destino')
  await expect(tabs.getByRole('tab')).toHaveText(['origen.md', 'destino.md'])
  await expect(tabs.getByRole('tab', { name: 'destino.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.getByRole('tab', { name: 'origen.md', exact: true })).toHaveAttribute('data-dirty', 'true')
  expect(await fs.readFile(join(root, 'origen.md'), 'utf8')).toBe('[Destino](destino.md) y texto\n')
  await tabs.getByRole('tab', { name: 'origen.md', exact: true }).click()
  await expect(editor).toContainText('cambio')
  await expect(page.getByRole('status')).toHaveText('Cambios sin guardar')
  await editor.getByRole('link', { name: 'Destino', exact: true }).click({ modifiers: ['Control'] })
  await expect(tabs.getByRole('tab', { name: 'destino.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.getByRole('tab')).toHaveCount(2)
})

test('un resultado de enlace obsoleto no abre pestaña si ya se cambió de nota', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('enlaces-obsoletos')
  const { open, snapshot } = await notebook(application, page, root, {
    'origen.md': '[Destino](destino.md)\n',
    'otra.md': '# Otra\n',
    'destino.md': '# Destino\n'
  })
  await open('origen.md')
  const origin = await page.evaluate(() => window.documents.current())
  const target = join(root, 'destino.md')
  const other = snapshot.notes.find((note) => note.name === 'otra.md')!
  expect(await page.evaluate((id) => window.workspace.open(id, 'new-tab'), other.id)).toEqual({ status: 'ok' })
  // El proceso principal rechaza abrir desde una nota que ya no es la activa.
  expect((await page.evaluate(([id, path]) => window.documents.openNote(id, path, 'new-tab'), [origin.id, target])).status).toBe('error')
  const tabs = page.getByRole('tablist', { name: 'Documentos abiertos' })
  await expect(tabs.getByRole('tab')).toHaveText(['origen.md', 'otra.md'])
  await expect(tabs.getByRole('tab', { name: 'otra.md', exact: true })).toHaveAttribute('aria-selected', 'true')
})

test('el proceso principal ignora protocolos, rutas absolutas, UNC y salidas del cuaderno', async ({ application, editorPage: page }, testInfo) => {
  await recordShell(application)
  const base = testInfo.outputPath('enlaces-seguridad')
  const root = join(base, 'cuaderno')
  await fs.mkdir(base, { recursive: true })
  await fs.writeFile(join(base, 'fuera.md'), '# Fuera\n')
  await fs.writeFile(join(base, 'fuera.pdf'), '%PDF-1.4')
  const { open } = await notebook(application, page, root, { 'sub/origen.md': 'Texto\n', 'sub/nota.md': '# Nota\n' })
  await open('sub/origen.md')
  const id = (await page.evaluate(() => window.documents.current())).id
  const outside = join(base, 'fuera.md').replace(/\\/g, '/')
  const hrefs = [
    'file:///C:/Windows/System32/notepad.exe',
    'javascript:alert(1)',
    'ms-settings:',
    'C:\\Windows\\System32\\notepad.exe',
    'C:/Windows/win.ini',
    outside,
    `/${outside}`,
    '\\\\servidor\\recurso\\nota.md',
    '//servidor/recurso/nota.md',
    '%5c%5cservidor%5crecurso%5cnota.md',
    '../../fuera.md',
    '..\\..\\fuera.md',
    '%2e%2e/%2e%2e/fuera.md',
    'nota.md/../../../fuera.pdf',
    '..%2f..%2ffuera.pdf',
    '%2fWindows%2fwin.ini',
    'nota.md%00.exe',
    'nota.md:secreto',
    'nota.md::$DATA',
    '%E0%A4%A',
    'https://',
    'http:/sin-host'
  ]
  for (const href of hrefs) {
    const result = await page.evaluate(([id, href]) => window.documents.followLink(id, href), [id, href] as const)
    expect(result.status, href).not.toBe('ok')
  }
  expect(await page.evaluate(() => window.documents.followLink('otro-id', 'nota.md'))).toMatchObject({ status: 'error' })
  expect(await page.evaluate(([id]) => window.documents.followLink(id, 7 as unknown as string), [id] as const)).toMatchObject({ status: 'error' })
  expect(await shellCalls(application)).toEqual([])
  expect((await page.evaluate(() => window.documents.current())).name).toBe('origen.md')
  for (const path of [join(base, 'fuera.md'), 'sub/nota.md', join(root, 'sub', 'nota.txt'), 7]) {
    const result = await page.evaluate(([id, path]) => window.documents.openNote(id, path as string), [id, path] as const)
    expect(result.status, String(path)).toBe('error')
  }
  expect((await page.evaluate(() => window.documents.current())).name).toBe('origen.md')
  const note = await page.evaluate(([id]) => window.documents.followLink(id, './nota.md#Inicio'), [id] as const)
  const real = await fs.realpath(join(root, 'sub', 'nota.md'))
  expect(note).toEqual({ status: 'note', path: real, anchor: 'Inicio' })
  expect((await page.evaluate(() => window.documents.current())).name).toBe('origen.md')
  expect(await page.evaluate(([id, path]) => window.documents.openNote(id, path), [id, real] as const)).toEqual({ status: 'ok' })
  expect((await page.evaluate(() => window.documents.current())).name).toBe('nota.md')
})

test('un enlace que se resuelve después de abrir otra nota no la reemplaza', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('enlaces-obsoletos')
  const { snapshot, open } = await notebook(application, page, root, {
    'origen.md': '[Destino](destino.md)\n',
    'destino.md': '# Destino\n',
    'otra.md': '# Otra\n'
  })
  await open('origen.md')
  // Retiene la resolución del enlace hasta que se abre otra nota.
  await application.evaluate(() => {
    const fs = process.mainModule!.require('node:fs').promises
    const original = fs.realpath
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let armed = true
    Object.assign(globalThis, { releaseLink: release, linkWaiting: false })
    fs.realpath = async (...args: unknown[]) => {
      if (armed && String(args[0]).includes('destino')) {
        armed = false
        Object.assign(globalThis, { linkWaiting: true })
        await gate
      }
      return original.apply(fs, args)
    }
  })
  const editor = page.getByRole('textbox', { name: 'Documento Markdown', exact: true })
  await editor.getByRole('link', { name: 'Destino', exact: true }).click({ modifiers: ['Control'] })
  await expect.poll(() => application.evaluate(() => (globalThis as unknown as { linkWaiting: boolean }).linkWaiting)).toBe(true)
  const other = snapshot.notes.find((note) => note.relativePath === 'otra.md')!
  expect(await page.evaluate((id) => window.workspace.open(id), other.id)).toEqual({ status: 'ok' })
  await expect(editor.locator('h1')).toHaveText('Otra')
  await application.evaluate(() => (globalThis as unknown as { releaseLink(): void }).releaseLink())
  await page.waitForTimeout(500)
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled()
  await expect(editor.locator('h1')).toHaveText('Otra')
  expect((await page.evaluate(() => window.documents.current())).name).toBe('otra.md')
})
