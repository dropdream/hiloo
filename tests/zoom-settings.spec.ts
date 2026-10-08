import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { test, expect, chooseChanges, chooseOpen, closeApplication, launchApplication } from './fixtures'

test('la barra de zoom acerca, aleja, ajusta a pantalla y no afecta a la impresión', async ({ application, editorPage: page }, testInfo) => {
  const path = testInfo.outputPath('zoom.md')
  await fs.mkdir(testInfo.outputPath(), { recursive: true })
  await fs.writeFile(path, '# Zoom\n\nTexto para ampliar.\n')
  await chooseOpen(application, path)
  await page.getByRole('button', { name: 'Abrir', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Documento Markdown', exact: true })
  await expect(editor.locator('h1')).toHaveText('Zoom')
  const bar = page.getByRole('group', { name: 'Zoom del documento', exact: true })
  const sheet = page.locator('.hiloo-document').locator('xpath=ancestor::div[contains(@style, "zoom")]')
  const zoom = () => sheet.evaluate((element) => getComputedStyle(element).zoom)
  await expect(bar.getByRole('slider', { name: 'Zoom', exact: true })).toHaveValue('100')
  await bar.getByRole('button', { name: 'Acercar', exact: true }).click()
  await bar.getByRole('button', { name: 'Acercar', exact: true }).click()
  await expect(bar.getByRole('button', { name: 'Zoom 120 %. Restablecer al 100 %', exact: true })).toBeVisible()
  expect(await zoom()).toBe('1.2')
  await bar.getByRole('button', { name: 'Alejar', exact: true }).click()
  expect(await zoom()).toBe('1.1')
  await bar.getByRole('slider', { name: 'Zoom', exact: true }).fill('50')
  expect(await zoom()).toBe('0.5')
  await expect(bar.getByRole('button', { name: 'Alejar', exact: true })).toBeDisabled()
  await editor.press('Control+0')
  expect(await zoom()).toBe('1')
  expect(await fs.readFile(path, 'utf8')).toBe('# Zoom\n\nTexto para ampliar.\n')
  await expect(page.getByRole('status')).toHaveText('Guardado')

  const nativeWindow = await application.browserWindow(page)
  await nativeWindow.evaluate((window) => window.setSize(1600, 800))
  const fit = bar.getByRole('button', { name: 'Ajustar a pantalla', exact: true })
  await fit.click()
  await expect(fit).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => Number(await zoom())).toBeGreaterThan(1.5)
  const sheetWidth = await page.locator('.hiloo-document').evaluate((element) => element.closest('[style*="zoom"]')!.getBoundingClientRect().width)
  const areaWidth = await page.getByRole('main').evaluate((element) => element.clientWidth)
  expect(sheetWidth).toBeLessThanOrEqual(areaWidth)
  await page.screenshot({ path: testInfo.outputPath('zoom-ajustado.png') })
  await nativeWindow.evaluate((window) => window.setSize(1000, 700))
  await expect.poll(async () => Number(await zoom())).toBeLessThan(1.3)
  await bar.getByRole('button', { name: 'Acercar', exact: true }).click()
  await expect(fit).toHaveAttribute('aria-pressed', 'false')

  await page.emulateMedia({ media: 'print' })
  expect(await zoom()).toBe('1')
  await expect(bar).toBeHidden()
  await page.emulateMedia({ media: 'screen' })

  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await bar.getByRole('button', { name: /^Zoom \d+ %/ }).click()
  await bar.getByRole('button', { name: 'Acercar', exact: true }).click()
  expect(await page.getByRole('textbox', { name: 'Código Markdown', exact: true }).evaluate((element) => getComputedStyle(element).fontSize)).toBe('15.4px')
})

test('documentos recientes se listan, reabren y persisten tras reiniciar', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('documentos')
  await fs.mkdir(root, { recursive: true })
  const first = join(root, 'primero.md')
  const second = join(root, 'segundo.md')
  await fs.writeFile(first, '# Primero\n')
  await fs.writeFile(second, '# Segundo\n')
  for (const path of [first, second]) {
    await chooseOpen(application, path)
    expect(await page.evaluate(() => window.documents.open())).toEqual({ status: 'ok' })
  }
  const list = await page.evaluate(() => window.documents.recent())
  expect(list.map((entry) => entry.path)).toEqual([second, first])
  expect(list.map((entry) => entry.current)).toEqual([true, false])
  expect(await page.evaluate(() => window.documents.openRecent('no-es-un-id'))).toEqual({ status: 'error', message: 'El documento seleccionado no pertenece a los recientes.' })

  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  const sidebar = page.getByRole('complementary', { name: 'Notas del cuaderno' })
  const menu = sidebar.getByRole('group', { name: 'Menú del panel', exact: true })
  const trigger = menu.getByRole('button', { name: 'Documentos recientes', exact: true })
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const panel = sidebar.getByRole('region', { name: 'Lista de documentos recientes', exact: true })
  const current = panel.getByRole('button', { name: `Abrir documento reciente: ${second}`, exact: true })
  await expect(current).toBeDisabled()
  await expect(current).toContainText('Actual')
  await page.screenshot({ path: testInfo.outputPath('documentos-recientes.png') })
  await panel.getByRole('button', { name: `Abrir documento reciente: ${first}`, exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Documento Markdown', exact: true }).locator('h1')).toHaveText('Primero')
  await expect(panel).toBeHidden()
  expect((await page.evaluate(() => window.documents.recent())).map((entry) => entry.path)).toEqual([first, second])

  await fs.rm(second)
  await trigger.click()
  await panel.getByRole('button', { name: `Abrir documento reciente: ${second}`, exact: true }).click()
  await expect(sidebar.getByRole('alert')).toHaveText('El documento ya no está disponible. Comprueba su ubicación o ábrelo con Abrir.')
  await expect(page.getByRole('textbox', { name: 'Documento Markdown', exact: true }).locator('h1')).toHaveText('Primero')
  await trigger.press('Escape')
  await expect(panel).toBeHidden()
  await expect(trigger).toBeFocused()

  await closeApplication(application)
  const restarted = await launchApplication(testInfo)
  try {
    const nextPage = await restarted.firstWindow()
    await expect(nextPage.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled()
    const after = await nextPage.evaluate(() => window.documents.recent())
    expect(after.map((entry) => [entry.path, entry.current])).toEqual([[first, false], [second, false]])
  } finally { await closeApplication(restarted) }
})

test('CSS de impresión rechaza escapes del ámbito sin alterar las reglas guardadas', async ({ editorPage: page }) => {
  const original = 'color: rgb(1, 2, 3); h1 { text-align: center; }'
  expect((await page.evaluate((css) => window.settings.setPrintStyle(css), original)).status).toBe('ok')
  for (const css of [
    '} } body { display: none } /*',
    '} } body { display: none } @media print { .hiloo-document {',
    '& + * { display: none }',
    ':is(&, body) { display: none }',
    '+ * { display: none }',
    '@media print { ~ * { display: none } }',
    '@font-face { font-family: Global; src: url(https://example.com/font.woff2); }',
    '@import "https://example.com/style.css";'
  ]) {
    expect((await page.evaluate((value) => window.settings.setPrintStyle(value), css)).status).toBe('error')
    expect(await page.evaluate(() => window.settings.printStyle())).toBe(original)
  }
  expect(await page.locator('body').evaluate((element) => getComputedStyle(element).display)).not.toBe('none')
  expect((await page.evaluate(() => window.settings.setPrintStyle('@media (min-width: 1px) { h1 { color: red; } }'))).status).toBe('ok')
})

test('CSS de impresión se guarda desde Configuraciones y solo se aplica al imprimir', async ({ application, editorPage: page }, testInfo) => {
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await page.getByRole('textbox', { name: 'Código Markdown', exact: true }).fill('# Título\n\nUn párrafo.\n')
  await page.getByRole('button', { name: 'Vista impresión', exact: true }).click()
  const heading = page.getByRole('textbox', { name: 'Documento Markdown', exact: true }).locator('h1')
  await expect(heading).toHaveText('Título')

  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  const sidebar = page.getByRole('complementary', { name: 'Notas del cuaderno' })
  await sidebar.getByRole('button', { name: 'Configuraciones', exact: true }).click()
  await sidebar.getByRole('region', { name: 'Configuraciones', exact: true }).getByRole('button', { name: /CSS de impresión/ }).click()
  const dialog = page.getByRole('dialog', { name: 'CSS de impresión', exact: true })
  await expect(dialog).toBeVisible()
  const css = dialog.getByRole('textbox', { name: 'Reglas CSS', exact: true })
  await expect(css).toBeFocused()
  await css.fill('font-family: Georgia, serif;\nh1 { font-size: 30pt; text-align: center; }\np { text-align: justify; }')
  await page.screenshot({ path: testInfo.outputPath('css-impresion.png') })
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(sidebar).toBeVisible()
  expect(await page.evaluate(() => window.settings.printStyle())).toContain('text-align: center')
  expect(await fs.readFile(testInfo.outputPath('.profile', 'print-style.css'), 'utf8')).toContain('30pt')

  expect(await heading.evaluate((element) => getComputedStyle(element).textAlign)).not.toBe('center')
  await page.emulateMedia({ media: 'print' })
  expect(await heading.evaluate((element) => getComputedStyle(element).textAlign)).toBe('center')
  expect(await heading.evaluate((element) => getComputedStyle(element).fontSize)).toBe('40px')
  expect(await heading.evaluate((element) => getComputedStyle(element.closest('.hiloo-document')!).fontFamily)).toContain('Georgia')
  // Las reglas no deben afectar a los controles de la aplicación.
  expect(await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily)).not.toContain('Georgia')
  await page.emulateMedia({ media: 'screen' })

  expect(await page.evaluate(() => window.settings.setPrintStyle('a'.repeat(64 * 1024 + 1)))).toEqual({ status: 'error', message: 'El CSS de impresión supera el límite de 64 KB.' })
  await chooseChanges(application, 1)
  await closeApplication(application)
  const restarted = await launchApplication(testInfo)
  try {
    const nextPage = await restarted.firstWindow()
    await expect(nextPage.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled()
    expect(await nextPage.evaluate(() => window.settings.printStyle())).toContain('30pt')
    await expect(nextPage.locator('style[data-print-style]')).toHaveCount(1)
  } finally { await closeApplication(restarted) }
})
