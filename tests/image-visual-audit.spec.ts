import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { test, expect, chooseOpen } from './fixtures'
import { markdownSignature } from '../src/shared/markdown'

const editor = (page: Page) => page.getByRole('textbox', { name: 'Documento Markdown' })
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

// Imágenes reproducibles con tamaño real para comprobar su disposición.
async function artwork(page: Page, width: number, height: number, mime: 'image/png' | 'image/jpeg') {
  const encoded = await page.evaluate(({ width, height, mime }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')!
    context.fillStyle = '#edf2e8'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#173f52'
    context.fillRect(0, height * .6, width, height * .4)
    context.fillStyle = '#df783e'
    context.beginPath()
    context.arc(width * .76, height * .35, Math.min(width, height) * .15, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#4e8574'
    context.beginPath()
    context.moveTo(0, height * .63)
    context.lineTo(width * .33, height * .3)
    context.lineTo(width * .67, height * .63)
    context.fill()
    context.fillStyle = '#173f52'
    context.font = `bold ${Math.round(width * .065)}px Arial`
    context.fillText('HILOO / IMAGEN', width * .06, height * .12)
    context.fillStyle = '#ffffff'
    context.font = `bold ${Math.round(width * .055)}px Arial`
    context.fillText(`${width} x ${height}`, width * .06, height * .77)
    context.font = `${Math.round(width * .037)}px Arial`
    context.fillText(`${mime === 'image/png' ? 'PNG' : 'JPEG'} · proporción original`, width * .06, height * .86)
    context.strokeStyle = '#df783e'
    context.lineWidth = 12
    context.strokeRect(6, 6, width - 12, height - 12)
    return canvas.toDataURL(mime, .9).split(',')[1]
  }, { width, height, mime })
  return Buffer.from(encoded, 'base64')
}

async function open(application: ElectronApplication, page: Page, path: string) {
  await chooseOpen(application, path)
  await button(page, 'Abrir').click()
  await expect(editor(page)).toBeVisible()
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true')
}

async function visibleRaster(image: Locator, width: number, height: number) {
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight])).toEqual([width, height])
  await expect(image.locator('..').locator('.image-fallback')).toBeHidden()
  const dimensions = await image.evaluate((node: HTMLImageElement) => {
    const bounds = node.getBoundingClientRect()
    const parent = node.closest('td, th') ?? node.closest('p')!
    const style = getComputedStyle(parent)
    const available = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    return { width: bounds.width, height: bounds.height, available, hidden: node.hidden, display: getComputedStyle(node).display }
  })
  expect(dimensions.hidden).toBe(false)
  expect(dimensions.display).not.toBe('none')
  expect(dimensions.width).toBeGreaterThan(80)
  expect(dimensions.height).toBeGreaterThan(40)
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.available + 1)
  expect(Math.abs(dimensions.width / dimensions.height - width / height)).toBeLessThan(.015)
  return dimensions
}

const cases = [
  { name: 'landscape-local-png', width: 1200, height: 675, mime: 'image/png', remote: false },
  { name: 'portrait-local-png', width: 600, height: 900, mime: 'image/png', remote: false },
  { name: 'landscape-local-jpeg', width: 1200, height: 675, mime: 'image/jpeg', remote: false },
  { name: 'landscape-http-jpeg', width: 1200, height: 675, mime: 'image/jpeg', remote: true }
] as const

for (const sample of cases) {
  test(`auditor visual: ${sample.name} visible, proporcional, adaptable y editable`, async ({ application, editorPage: page }, info) => {
    const bytes = await artwork(page, sample.width, sample.height, sample.mime)
    const filename = sample.mime === 'image/png' ? 'imagen.png' : 'imagen.jpg'
    const path = info.outputPath('documento.md')
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(info.outputPath(filename), bytes)
    const source = sample.remote ? `https://visual-audit.test/${filename}` : filename
    if (sample.remote) await page.route('https://visual-audit.test/**', route => route.fulfill({ contentType: sample.mime, body: bytes }))
    const markdown = `# Imagen ${sample.width} × ${sample.height}\n\n![Arte de prueba](${source})\n\nTexto posterior conservado.\n`
    await fs.writeFile(path, markdown)
    await open(application, page, path)
    const image = editor(page).locator('.document-image img')
    const measurements = []
    for (const windowWidth of [1000, 420]) {
      await (await application.browserWindow(page)).evaluate((win, width) => win.setSize(width, 1100), windowWidth)
      measurements.push({ windowWidth, ...await visibleRaster(image, sample.width, sample.height) })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await image.scrollIntoViewIfNeeded()
      await page.screenshot({ path: info.outputPath(`${sample.name}-${windowWidth}.png`) })
    }
    expect(measurements[1].width).toBeLessThan(measurements[0].width)
    await info.attach('rendered-dimensions', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
    await image.click()
    await button(page, 'Imagen').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading')).toHaveText('Editar imagen')
    await expect(dialog.getByLabel('Origen', { exact: true })).toHaveValue(source)
    await dialog.getByLabel('Texto alternativo', { exact: true }).fill('Imagen grande editada')
    await dialog.getByRole('button', { name: 'Aplicar', exact: true }).click()
    await button(page, 'Guardar').click()
    await expect(page.getByRole('status')).toHaveText('Guardado')
    expect(markdownSignature(await fs.readFile(path, 'utf8'))).toBe(markdownSignature(markdown.replace('Arte de prueba', 'Imagen grande editada')))
    await open(application, page, path)
    await visibleRaster(image, sample.width, sample.height)
    await image.click()
    await button(page, 'Imagen').click()
    await expect(page.getByRole('dialog').getByRole('heading')).toHaveText('Editar imagen')
    await expect(page.getByRole('dialog').getByLabel('Texto alternativo', { exact: true })).toHaveValue('Imagen grande editada')
    await page.keyboard.press('Escape')
  })
}

test('auditor visual: imagen grande dentro de tabla respeta celda y persiste', async ({ application, editorPage: page }, info) => {
  const bytes = await artwork(page, 1200, 675, 'image/png')
  const path = info.outputPath('tabla.md')
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(info.outputPath('tabla.png'), bytes)
  const markdown = '| Vista | Descripción |\n| --- | --- |\n| ![Vista grande](tabla.png) | Imagen de 1200 × 675 dentro de una celda. |\n'
  await fs.writeFile(path, markdown)
  await open(application, page, path)
  const image = editor(page).locator('td .document-image img')
  for (const windowWidth of [1000, 420]) {
    await (await application.browserWindow(page)).evaluate((win, width) => win.setSize(width, 1100), windowWidth)
    await visibleRaster(image, 1200, 675)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await image.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`table-image-${windowWidth}.png`) })
  }
  await image.click()
  await button(page, 'Imagen').click()
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText('Editar imagen')
  await page.getByRole('dialog').getByLabel('Título', { exact: true }).fill('Vista en tabla')
  await page.getByRole('dialog').getByRole('button', { name: 'Aplicar', exact: true }).click()
  await button(page, 'Guardar').click()
  await expect(page.getByRole('status')).toHaveText('Guardado')
  expect(markdownSignature(await fs.readFile(path, 'utf8'))).toBe(markdownSignature(markdown.replace('(tabla.png)', '(tabla.png "Vista en tabla")')))
  await open(application, page, path)
  await visibleRaster(image, 1200, 675)
  await expect(image).toHaveAttribute('title', 'Vista en tabla')
})

for (const placement of ['local', 'http', 'table'] as const) {
  test(`auditor visual: foto real ${placement} adaptable y editable sin alterar original`, async ({ application, editorPage: page }, info) => {
    const original = process.env.HILOO_AUDIT_IMAGE
    test.skip(!original, 'Provide a local JPEG with HILOO_AUDIT_IMAGE; private fixtures are never committed.')
    const bytes = await fs.readFile(original!)
    const originalHash = createHash('sha256').update(bytes).digest('hex')
    const size = await application.evaluate(({ nativeImage }, path) => nativeImage.createFromPath(path).getSize(), original!)
    expect(size.width).toBeGreaterThan(1000)
    expect(size.height).toBeGreaterThan(600)
    const path = info.outputPath('foto-real.md')
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(info.outputPath('foto.jpg'), bytes)
    const source = placement === 'http' ? 'https://visual-audit.test/private-photo.jpg' : 'foto.jpg'
    let mockedRequests = 0
    if (placement === 'http') await page.route('https://visual-audit.test/**', route => {
      mockedRequests++
      return route.fulfill({ contentType: 'image/jpeg', body: bytes })
    })
    const markdown = placement === 'table'
      ? '| Fotografía | Descripción |\n| --- | --- |\n| ![Fotografía real](foto.jpg) | Imagen suministrada para esta verificación visual. |\n'
      : `# Fotografía real\n\n![Fotografía real](${source})\n\nDocumento de verificación visual.\n`
    await fs.writeFile(path, markdown)
    await open(application, page, path)
    const image = editor(page).locator('.document-image img')
    const measurements = []
    for (const windowWidth of [1000, 420]) {
      await (await application.browserWindow(page)).evaluate((win, width) => win.setSize(width, 1100), windowWidth)
      measurements.push({ windowWidth, ...await visibleRaster(image, size.width, size.height) })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await image.scrollIntoViewIfNeeded()
      await page.screenshot({ path: info.outputPath(`real-photo-${placement}-${windowWidth}.png`) })
    }
    expect(measurements[1].width).toBeLessThan(measurements[0].width)
    await info.attach('photo-dimensions', { body: JSON.stringify({ intrinsic: size, rendered: measurements }, null, 2), contentType: 'application/json' })
    await image.click()
    await button(page, 'Imagen').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading')).toHaveText('Editar imagen')
    await expect(dialog.getByLabel('Origen', { exact: true })).toHaveValue(source)
    await dialog.getByLabel('Texto alternativo', { exact: true }).fill('Fotografía verificada')
    await dialog.getByRole('button', { name: 'Aplicar', exact: true }).click()
    await button(page, 'Guardar').click()
    await expect(page.getByRole('status')).toHaveText('Guardado')
    expect(markdownSignature(await fs.readFile(path, 'utf8'))).toBe(markdownSignature(markdown.replace('![Fotografía real]', '![Fotografía verificada]')))
    await open(application, page, path)
    await visibleRaster(image, size.width, size.height)
    await image.click()
    await button(page, 'Imagen').click()
    await expect(page.getByRole('dialog').getByRole('heading')).toHaveText('Editar imagen')
    await expect(page.getByRole('dialog').getByLabel('Texto alternativo', { exact: true })).toHaveValue('Fotografía verificada')
    await page.keyboard.press('Escape')
    if (placement === 'http') expect(mockedRequests).toBeGreaterThan(0)
    expect(createHash('sha256').update(await fs.readFile(original!)).digest('hex')).toBe(originalHash)
  })
}
