import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { test, expect } from './fixtures'
import { BrainIndex } from '../src/main/brain'

interface Query { id: string; query: string; gold: { path: string; heading: string }[] }

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'local', 'Las pruebas del motor usan SQLite del runtime de pruebas.')
})

// Mini-cuadernos sintéticos: las preguntas usan otras flexiones que el texto de la nota.
for (const language of ['es', 'en', 'pt', 'fr', 'de', 'it'] as const) {
  test(`el cuaderno en ${language} se detecta y sus preguntas flexionadas encuentran la sección`, async ({}, testInfo) => {
    const root = resolve('tests/fixtures/brain-languages', language)
    const queries = JSON.parse(await fs.readFile(join(root, 'queries.json'), 'utf8')) as Query[]
    const index = new BrainIndex(testInfo.outputPath('brain.sqlite'))
    try {
      const notebook = await index.registerNotebook(root)
      await index.sync(notebook.id)
      expect((await index.catalog()).items[0].detectedLanguage).toBe(language)
      const found: string[] = []
      for (const query of queries.filter((item) => item.gold.length)) {
        const { items } = await index.search({ query: query.query, notebookId: notebook.id, limit: 3 })
        const [gold] = query.gold
        if (items.some((item) => item.relativePath === gold.path && item.heading.split(' / ').includes(gold.heading))) found.push(query.id)
      }
      expect(found.length, `encontradas: ${found.join(', ')}`).toBeGreaterThanOrEqual(6)
    } finally { index.close() }
  })
}
