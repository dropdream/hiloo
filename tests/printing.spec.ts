import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import type { WebContentsPrintOptions } from 'electron'
import type { PageSettings } from '../src/shared/printing'
import { test, expect, chooseOpen } from './fixtures'

interface PrintCapture {
  options: WebContentsPrintOptions
  html: string
}

interface PrintState {
  calls: PrintCapture[]
  success: boolean
  reason: string
  pdf?: string
  error?: string
}

// Never allow these tests to open a printer dialog or submit a physical print job.
async function interceptPrint(application: ElectronApplication, pdf = false) {
  await application.evaluate(({ BrowserWindow }, pdf) => {
    const state: PrintState = { calls: [], success: true, reason: '' }
    const scope = globalThis as typeof globalThis & { printTest: PrintState }
    scope.printTest = state
    const contents = BrowserWindow.getAllWindows()[0].webContents
    contents.print = (options, callback) => {
      void (async () => {
        const html = await contents.executeJavaScript('document.body.innerHTML') as string
        state.calls.push({ options: options ?? {}, html })
        if (pdf) state.pdf = (await contents.printToPDF({ preferCSSPageSize: true, printBackground: true })).toString('base64')
        callback?.(state.success, state.reason)
      })().catch(error => {
        state.error = String(error)
        callback?.(false, String(error))
      })
    }
  }, pdf)
}

async function printState(application: ElectronApplication) {
  return application.evaluate(() => (globalThis as typeof globalThis & { printTest: PrintState }).printTest)
}

test('Imprimir permite recuperar desde Markdown un documento con conversión inicial bloqueada', async ({ application, editorPage: page }, testInfo) => {
  const path = testInfo.outputPath('conversion-bloqueada.md')
  const original = '\uFEFF# Base\r\n\r\nOriginal.\r\nEdicion uno.\r\n'
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, original)
  await interceptPrint(application)
  await chooseOpen(application, path)
  await page.getByRole('button', { name: 'Abrir', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('La conversión visual cambiaría la estructura')
  await expect(page.getByRole('button', { name: 'Imprimir', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Código Markdown', exact: true })
  await source.fill('# Recuperado\n\nContenido válido.\n')
  await expect(page.getByRole('button', { name: 'Imprimir', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Imprimir', exact: true }).click()
  await expect.poll(async () => (await printState(application)).calls.length).toBe(1)
  const state = await printState(application)
  expect(state.error).toBeUndefined()
  expect(state.calls[0].html).toMatch(/<h1[^>]*>Recuperado<\/h1>/)
  expect(state.calls[0].html).toContain('<p>Contenido válido.</p>')
  expect(state.calls[0].html).not.toContain('Edicion uno.')
  await expect(source).toBeVisible()
  await expect(source).toHaveValue('# Recuperado\n\nContenido válido.\n')
  await expect(page.getByRole('button', { name: 'Markdown', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('status')).toHaveText('Cambios sin guardar')
  expect(await fs.readFile(path, 'utf8')).toBe(original)
})

test('formatos predefinidos y personalizados envían medidas exactas a impresión sin modificar el documento', async ({ application, editorPage: page }) => {
  await interceptPrint(application)
  const formats: Array<[string, string, number, number]> = [
    ['Carta', 'letter', 215.9, 279.4], ['Oficio', 'oficio', 216, 330],
    ['Legal', 'legal', 215.9, 355.6], ['A4', 'a4', 210, 297], ['A5', 'a5', 148, 210],
    ['Personalizado', 'custom', 180.5, 240.5]
  ]
  for (const [label, , width, height] of formats) {
    await page.getByRole('button', { name: 'Formato de página', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Formato de página', exact: true })
    await dialog.getByRole('combobox', { name: 'Tamaño de papel', exact: true }).selectOption({ label })
    if (label === 'Personalizado') {
      await dialog.getByLabel('Ancho (mm)', { exact: true }).fill(String(width))
      await dialog.getByLabel('Alto (mm)', { exact: true }).fill(String(height))
    }
    await dialog.getByRole('button', { name: 'Aplicar', exact: true }).click()
    const count = (await printState(application)).calls.length
    await page.getByRole('button', { name: 'Imprimir', exact: true }).click()
    await expect.poll(async () => (await printState(application)).calls.length).toBe(count + 1)
    const { options } = (await printState(application)).calls[count]
    expect(options).toMatchObject({ silent: false, printBackground: true, pageSize: { width: width * 1000, height: height * 1000 } })
    await expect(page.getByRole('status')).toHaveText('Sin cambios')
  }
})

for (const [label, width, height] of [['A5', 148, 210], ['Personalizado', 240.5, 180.5]] as const) {
  test(`Ctrl+P imprime la edición Markdown reciente en PDF ${label} sin interfaz`, async ({ application, editorPage: page }, testInfo) => {
    await interceptPrint(application, true)
    await page.getByRole('button', { name: 'Formato de página', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Formato de página', exact: true })
    await dialog.getByRole('combobox', { name: 'Tamaño de papel', exact: true }).selectOption({ label })
    if (label === 'Personalizado') {
      await dialog.getByLabel('Ancho (mm)', { exact: true }).fill(String(width))
      await dialog.getByLabel('Alto (mm)', { exact: true }).fill(String(height))
    }
    await dialog.getByRole('button', { name: 'Aplicar', exact: true }).click()
    if (label === 'A5') await page.getByRole('button', { name: 'Fondo noche', exact: true }).click()
    await page.getByRole('textbox', { name: 'Documento Markdown', exact: true }).fill('VERSIÓN ANTIGUA QUE NO DEBE IMPRIMIRSE')
    await page.getByRole('button', { name: 'Markdown', exact: true }).click()
    const source = page.getByRole('textbox', { name: 'Código Markdown', exact: true })
    await source.fill('# Impresión actualizada\n\n**Contenido más reciente**\n\n| Nombre | Valor |\n| --- | --- |\n| Papel | Correcto |\n\n- [x] Preparado\n')
    await source.press('Control+P')
    await expect.poll(async () => {
      const state = await printState(application)
      return state.error ?? (state.pdf ? true : await page.getByRole('alert').allTextContents())
    }, { timeout: 30_000 }).toBe(true)
    const state = await printState(application)
    expect(state.error).toBeUndefined()
    expect(state.calls).toHaveLength(1)
    expect(state.calls[0].html).toContain('<strong>Contenido más reciente</strong>')
    expect(state.calls[0].html).not.toContain('VERSIÓN ANTIGUA QUE NO DEBE IMPRIMIRSE')
    const pdf = Buffer.from(state.pdf!, 'base64')
    await fs.writeFile(testInfo.outputPath('documento.pdf'), pdf)
    const boxes = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
    expect(boxes.length).toBeGreaterThan(0)
    for (const box of boxes) {
      expect(Math.abs(Number(box[1]) - width * 72 / 25.4)).toBeLessThan(1)
      expect(Math.abs(Number(box[2]) - height * 72 / 25.4)).toBeLessThan(1)
    }
    await expect(source).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Cambios sin guardar')
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByRole('button', { name: 'Imprimir', exact: true, includeHidden: true })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Guardar', exact: true, includeHidden: true })).not.toBeVisible()
    await expect(source).not.toBeVisible()
    await expect(page.locator('.hiloo-document h1')).toBeVisible()
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(page.locator('.hiloo-document')).toHaveCSS('color', 'rgb(0, 0, 0)')
    expect(await page.locator('.hiloo-document').evaluate(element => {
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        if (!['rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)'].includes(getComputedStyle(ancestor).backgroundColor)) return false
      }
      return true
    })).toBe(true)
    await page.emulateMedia({ media: 'screen' })
    await page.getByRole('button', { name: 'Vista impresión', exact: true }).click()
    if (label === 'A5') await page.getByRole('button', { name: 'Papel blanco', exact: true }).click()
    await expect(page.getByRole('main')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(page.getByRole('textbox', { name: 'Documento Markdown', exact: true })).toHaveCSS('color', 'rgb(23, 45, 64)')
    await page.screenshot({ path: testInfo.outputPath('document-wide.png') })
    await (await application.browserWindow(page)).evaluate(win => win.setSize(420, 700))
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(420)
    await expect(page.getByRole('main')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await page.screenshot({ path: testInfo.outputPath('document-narrow.png') })
    await page.getByRole('button', { name: 'Markdown', exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath('source-narrow.png') })
  })
}

test('cancelación y error de impresora restauran controles y conservan los cambios', async ({ application, editorPage: page }) => {
  await interceptPrint(application)
  await page.getByRole('textbox', { name: 'Documento Markdown', exact: true }).fill('Edición pendiente de guardar')
  await application.evaluate(() => Object.assign((globalThis as typeof globalThis & { printTest: PrintState }).printTest, { success: false, reason: 'Print job canceled' }))
  await page.getByRole('button', { name: 'Imprimir', exact: true }).click()
  await expect.poll(async () => (await printState(application)).calls.length).toBe(1)
  await expect(page.getByRole('button', { name: 'Imprimir', exact: true })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await application.evaluate(() => Object.assign((globalThis as typeof globalThis & { printTest: PrintState }).printTest, { success: false, reason: 'Injected printer failure' }))
  await page.keyboard.press('Control+P')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled()
  await expect(page.getByRole('textbox', { name: 'Documento Markdown', exact: true })).toHaveAttribute('contenteditable', 'true')
  await expect(page.getByRole('status')).toHaveText('Cambios sin guardar')
})

test('validación IPC rechaza medidas alteradas y un borrador no admitido nunca imprime la versión anterior', async ({ application, editorPage: page }) => {
  await interceptPrint(application)
  const results = await page.evaluate(async () => {
    const invalid = [null, {}, { format: 'a4', widthMm: 1, heightMm: 297 },
      { format: 'custom', widthMm: 49, heightMm: 200 }, { format: 'custom', widthMm: 200, heightMm: 1001 },
      { format: 'custom', widthMm: 180.55, heightMm: 240 }, { format: 'custom', widthMm: Number.NaN, heightMm: 240 },
      { format: 'custom', widthMm: 180, heightMm: 240, html: '<script>unsafe</script>' }]
    return Promise.all(invalid.map(value => window.documents.print(value as PageSettings)))
  })
  expect(results.every(result => result.status === 'error')).toBe(true)
  expect((await printState(application)).calls).toHaveLength(0)
  await page.getByRole('textbox', { name: 'Documento Markdown', exact: true }).fill('Contenido visual anterior')
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Código Markdown', exact: true })
  await source.fill('# Pendiente\n\n<script>alert(1)</script>\n')
  await source.press('Control+P')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(source).toHaveValue('# Pendiente\n\n<script>alert(1)</script>\n')
  expect((await printState(application)).calls).toHaveLength(0)
  await expect(page.getByRole('status')).toHaveText('Cambios sin guardar')
})

test('impresión rechaza una ventana ajena aunque disponga del preload', async ({ application, editorPage: page }) => {
  await interceptPrint(application)
  const failure = await application.evaluate(async ({ app, BrowserWindow }) => {
    const preload = process.getBuiltinModule('node:path').join(app.getAppPath(), 'out', 'preload', 'index.js')
    const stranger = new BrowserWindow({
      show: false,
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false }
    })
    try {
      await stranger.loadURL('data:text/html,<title>Origen ajeno</title>')
      return await stranger.webContents.executeJavaScript("window.documents.print({format:'a4',widthMm:210,heightMm:297}).then(() => 'accepted', error => error.message)") as string
    } finally { stranger.destroy() }
  })
  expect(failure).toContain('Origen de solicitud no permitido')
  expect((await printState(application)).calls).toHaveLength(0)
  await expect(page.getByRole('button', { name: 'Imprimir', exact: true })).toBeEnabled()
})
