import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { test, expect, chooseOpen, closeApplication, launchApplication } from './fixtures'

test('Cerebro registra cuadernos explícitos, busca globalmente y verifica cambios externos antes de leer', async ({ application, editorPage: page }, testInfo) => {
  const alpha = testInfo.outputPath('Alfa')
  const beta = testInfo.outputPath('Beta')
  await fs.mkdir(join(alpha, 'Proyectos'), { recursive: true })
  await fs.mkdir(beta)
  const source = join(alpha, 'Proyectos', 'orbita.md')
  await fs.writeFile(source, '# Órbita\n\nDecisión orbital compartida.\n\n[Beta](../../Beta/)\n')
  await fs.writeFile(join(beta, 'nota.md'), '# Referencia\n\nMemoria orbital secundaria.\n')
  for (const root of [alpha, beta]) {
    await chooseOpen(application, root)
    expect(await page.evaluate(() => window.workspace.choose())).toEqual({ status: 'ok' })
  }
  const catalog = await page.evaluate(() => window.brain.catalog())
  expect(catalog.items.map((entry) => entry.root).sort()).toEqual([alpha, beta].sort())
  const notebook = catalog.items.find((entry) => entry.root === alpha)!
  const results = await page.evaluate(() => window.brain.search({ query: 'orbital', maxChars: 6000 }))
  expect(new Set(results.items.map((entry) => entry.notebookId)).size).toBe(2)
  expect(JSON.stringify(results).length).toBeLessThanOrEqual(6000)
  const hit = results.items.find((entry) => entry.notebookId === notebook.id)!
  const fresh = await page.evaluate((chunkId) => window.brain.read({ chunkIds: [chunkId] }), hit.chunkId)
  expect(fresh.items[0].status).toBe('ok')
  expect(fresh.items[0].content).toContain('orbital')
  await fs.writeFile(source, '# Órbita\n\nDecisión revisada desde fuera.\n')
  const stale = await page.evaluate((chunkId) => window.brain.read({ chunkIds: [chunkId] }), hit.chunkId)
  expect(stale.items[0].status).toBe('stale')
  expect(stale.items[0].content).toBeUndefined()
  await page.evaluate((id) => window.brain.sync(id), notebook.id)
  expect((await page.evaluate((id) => window.brain.search({ query: 'revisada', notebookId: id }), notebook.id)).items.length).toBeGreaterThan(0)

  const loose = testInfo.outputPath('Suelto')
  await fs.mkdir(loose)
  const looseFile = join(loose, 'nota.md')
  await fs.writeFile(looseFile, '# Nota suelta\n')
  await chooseOpen(application, looseFile)
  expect(await page.evaluate(() => window.documents.open())).toEqual({ status: 'ok' })
  expect((await page.evaluate(() => window.brain.catalog())).items).toHaveLength(2)
})

test('Cerebro conserva relaciones manuales entre carpetas y cuadernos tras reiniciar y rechaza solicitudes fuera de contrato', async ({ application, editorPage: page }, testInfo) => {
  const root = testInfo.outputPath('Cuaderno')
  await fs.mkdir(join(root, 'Ideas'), { recursive: true })
  await chooseOpen(application, root)
  expect(await page.evaluate(() => window.workspace.choose())).toEqual({ status: 'ok' })
  const notebook = (await page.evaluate(() => window.brain.catalog())).items[0]
  const children = await page.evaluate((nodeId) => window.brain.related({ nodeId, type: 'hierarchy', direction: 'out' }), notebook.id)
  const folder = children.items.find((item) => item.kind === 'folder')!
  expect(folder.relativePath).toBe('Ideas')
  const link = await page.evaluate(({ sourceId, targetId }) => window.brain.link({ sourceId, targetId, label: 'Organiza' }), { sourceId: folder.nodeId, targetId: notebook.id })
  await page.evaluate((id) => window.brain.sync(id), notebook.id)
  const related = await page.evaluate((nodeId) => window.brain.related({ nodeId, type: 'manual', direction: 'out', maxChars: 1000 }), folder.nodeId)
  expect(JSON.stringify(related).length).toBeLessThanOrEqual(1000)
  expect(related.items[0].nodeId).toBe(notebook.id)
  expect(related.items[0].linkId).toBe(link.id)
  const rejections = await page.evaluate(async () => {
    const attempts = [
      () => window.brain.search({ query: 'a', limit: 1000 }),
      () => window.brain.search({ query: 'a', root: 'C:\\' } as never),
      () => window.brain.read({ chunkIds: Array(9).fill('x') }),
      () => window.brain.sync('../outside'),
      () => window.brain.related({ nodeId: 'x', type: 'invalid' } as never)
    ]
    return Promise.all(attempts.map(async (attempt) => { try { await attempt(); return false } catch { return true } }))
  })
  expect(rejections).toEqual([true, true, true, true, true])
  await closeApplication(application)
  const reopened = await launchApplication(testInfo)
  try {
    const nextPage = await reopened.firstWindow()
    await expect(nextPage.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled()
    const restored = await nextPage.evaluate((nodeId) => window.brain.related({ nodeId, type: 'manual', direction: 'out' }), folder.nodeId)
    expect(restored.items[0].linkId).toBe(link.id)
    await nextPage.evaluate((id) => window.brain.unlink(id), link.id)
    expect((await nextPage.evaluate((nodeId) => window.brain.related({ nodeId, type: 'manual', direction: 'out' }), folder.nodeId)).items).toEqual([])
  } finally { await closeApplication(reopened) }
})
