import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { test, expect, chooseOpen } from './fixtures'

const flow = '```mermaid\nflowchart LR\n  A[Inicio] --> B[Fin]\n```\n'

test('Mermaid conserva el archivo, permite editar y deshacer el flujo, y no interpreta otros bloques', async ({ application, editorPage: page }, testInfo) => {
  const path = testInfo.outputPath('flujos.md')
  const original = flow + '\n```javascript\nconst answer = 42\n```\n'
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, original)
  await chooseOpen(application, path)
  await page.getByRole('button', { name: 'Abrir', exact: true }).click()
  const diagram = page.locator('.document-mermaid')
  await expect(diagram).toHaveAttribute('data-rendered', 'true')
  await expect(diagram.getByRole('img')).toBeVisible()
  await expect(page.locator('.document-code pre')).toHaveText('const answer = 42')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  expect(await fs.readFile(path, 'utf8')).toBe(original)
  await diagram.locator('summary').click()
  const code = diagram.locator('code')
  await code.click()
  await page.keyboard.press('Home')
  await page.keyboard.type('%% Comentario\n')
  await expect(code).toContainText('Comentario')
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click()
  await expect(code).not.toContainText('Comentario')
  await expect(diagram).toHaveAttribute('data-rendered', 'true')
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Código Markdown', exact: true })
  await expect(source).toHaveValue(original)
  const edited = original.replace('B[Fin]', 'B[Destino]')
  await source.fill(edited)
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect.poll(() => fs.readFile(path, 'utf8')).toBe(edited)
  await chooseOpen(application, path)
  await page.getByRole('button', { name: 'Abrir', exact: true }).click()
  await page.getByRole('button', { name: 'Vista impresión', exact: true }).click()
  await expect(diagram).toHaveAttribute('data-rendered', 'true')
  await expect(diagram.locator('code')).toContainText('Destino')
})

test('Mermaid recupera errores, procesa varios flujos y prepara el código reciente antes de imprimir', async ({ application, editorPage: page }) => {
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Código Markdown', exact: true })
  await source.fill('```mermaid\nflowchart LR\nA --> [\n```\n')
  await page.getByRole('button', { name: 'Vista impresión', exact: true }).click()
  await expect(page.locator('.document-mermaid')).toHaveAttribute('data-loading', 'false')
  await expect(page.locator('.document-mermaid details')).toHaveAttribute('open', '')
  await expect(page.locator('.document-mermaid')).toContainText('No se pudo dibujar')
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await source.fill(flow + '\n```mermaid\ngraph TD\nC[Segundo] --> D[Listo]\n```\n')
  await application.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    contents.print = (_options, callback) => {
      void contents.executeJavaScript(`Array.from(document.querySelectorAll('.document-mermaid')).map(node => ({ loading: node.dataset.loading, complete: node.querySelector('img').complete, width: node.querySelector('img').naturalWidth, source: node.querySelector('code').textContent }))`).then((value) => {
        const scope = globalThis as typeof globalThis & { mermaidPrint: unknown }
        scope.mermaidPrint = value
        callback?.(true, '')
      })
    }
  })
  await page.getByRole('button', { name: 'Imprimir', exact: true }).click()
  await page.getByRole('dialog', { name: 'Vista previa de impresión' }).getByRole('button', { name: 'Imprimir', exact: true }).click()
  await expect.poll(async () => application.evaluate(() => (globalThis as typeof globalThis & { mermaidPrint?: unknown }).mermaidPrint)).toBeTruthy()
  const printed = await application.evaluate(() => (globalThis as typeof globalThis & { mermaidPrint: Array<{ loading: string; complete: boolean; width: number; source: string }> }).mermaidPrint)
  expect(printed).toHaveLength(2)
  for (const item of printed) {
    expect(item.loading).toBe('false')
    expect(item.complete).toBe(true)
    expect(item.width).toBeGreaterThan(0)
  }
  expect(printed[1].source).toContain('Segundo')
})

test('Mermaid rechaza configuración activa y tipos fuera de alcance conservando el código', async ({ editorPage: page }) => {
  for (const [code, message] of [
    ['%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\nA --> B', 'Las directivas'],
    ['flowchart LR\nA@{img: "https://example.com/image.png"}', 'Las imágenes'],
    ['flowchart LR\nA[Test]\nstyle A fill:u\\72l(https://example.com/image.svg)', 'Las imágenes'],
    ['sequenceDiagram\nAlice->>Bob: Hola', 'Solo se muestran']
  ]) {
    await page.getByRole('button', { name: 'Markdown', exact: true }).click()
    await page.getByRole('textbox', { name: 'Código Markdown', exact: true }).fill(`\`\`\`mermaid\n${code}\n\`\`\`\n`)
    await page.getByRole('button', { name: 'Vista impresión', exact: true }).click()
    await expect(page.locator('.document-mermaid')).toContainText(message)
    await expect(page.locator('.document-mermaid code')).toHaveText(code)
    await expect(page.locator('.mermaid-staging')).toHaveCount(0)
  }
})
