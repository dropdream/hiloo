import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { test, expect, chooseOpen } from './fixtures'
import { markdownLinkDestinations } from '../src/shared/markdown-links'
import { parseDocument } from '../src/main/brain/parse'

test('destinos del AST conservan orden, referencias y duplicados sin incluir imágenes', () => {
  const source = [
    '[Referencia][destino]',
    '[Primero](uno.md) y [Repetido](uno.md)',
    '> [Último](tres.md)',
    '![Imagen](imagen.png) y ![Otra][imagen]',
    '[destino]: dos.md',
    '[destino]: ignorado.md',
    '[imagen]: imagen-ref.png'
  ].join('\n\n')
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source)
  expect(markdownLinkDestinations(tree)).toEqual(['uno.md', 'uno.md', 'tres.md', 'dos.md'])
  expect(parseDocument(source, 'Nota').urls).toEqual(['uno.md', 'tres.md', 'dos.md'])
})

test('el recolector no limita destinos y Cerebro conserva su límite y estado parcial', () => {
  const parser = unified().use(remarkParse).use(remarkGfm)
  const repeated = Array.from({ length: 257 }, () => '[Nota](uno.md)').join('\n\n')
  expect(markdownLinkDestinations(parser.parse(repeated))).toHaveLength(257)
  expect(parseDocument(repeated, 'Nota')).toMatchObject({ urls: ['uno.md'], partial: true })
  const unique = Array.from({ length: 257 }, (_, index) => `[Nota](nota-${index}.md)`).join('\n\n')
  expect(markdownLinkDestinations(parser.parse(unique))).toHaveLength(257)
  const parsed = parseDocument(unique, 'Nota')
  expect(parsed.urls).toHaveLength(256)
  expect(parsed.urls.at(-1)).toBe('nota-255.md')
  expect(parsed.partial).toBe(true)
})

test('el enlace completo se edita entre nodos con formatos distintos', async ({ application, editorPage: page }, info) => {
  const path = info.outputPath('enlace.md')
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, '[aa**bb**_cc_**dd**ee](nota.md "Nota") fin\n')
  await chooseOpen(application, path)
  await page.getByRole('button', { name: 'Abrir', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Documento Markdown' })
  await expect(editor.locator('em a')).toHaveText('cc')
  await editor.locator('em a').evaluate(element => {
    const range = document.createRange()
    range.setStart(element.firstChild!, 1)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  const button = page.getByRole('button', { name: 'Enlace', exact: true })
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await button.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Texto', { exact: true })).toHaveValue('aabbccddee')
  await dialog.getByLabel('Dirección', { exact: true }).fill('otra.md')
  await dialog.getByRole('button', { name: 'Aplicar', exact: true }).click()
  await expect.poll(() => editor.locator('a').evaluateAll(links => links.every(link => link.getAttribute('href') === 'otra.md'))).toBe(true)
  await expect(editor.locator('a')).toHaveText(['aa', 'bb', 'cc', 'dd', 'ee'])
  await expect(editor.locator('strong')).toHaveText(['bb', 'dd'])
  await expect(editor.locator('em')).toHaveText('cc')
})
