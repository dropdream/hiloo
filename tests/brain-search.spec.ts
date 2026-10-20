import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { TestInfo } from '@playwright/test'
import { test, expect } from './fixtures'
import { BrainIndex } from '../src/main/brain'

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'local', 'Las pruebas del motor usan SQLite del runtime de pruebas.')
})

const notes: Record<string, string> = {
  'Sucursales.md': '# Sucursales\n\n## Decisiones\n\nLas sucursales cerradas quedan desactivadas y no se borran, porque las órdenes antiguas las referencian.\n',
  'Caja.md': '# Caja\n\n## Rendición\n\nCada día el cajero rinde el efectivo. Los archivos adjuntos admiten hasta 5 MB.\n',
  'Retiros.md': '# Retiros\n\n## Reagendamiento\n\nSi el retiro falla, el supervisor decide reagendarlo o anularlo.\n'
}

async function notebook(testInfo: TestInfo) {
  const root = testInfo.outputPath('cuaderno')
  await fs.mkdir(root, { recursive: true })
  for (const [name, text] of Object.entries(notes)) await fs.writeFile(join(root, name), text)
  const index = new BrainIndex(testInfo.outputPath('brain.sqlite'))
  const { id } = await index.registerNotebook(root)
  await index.sync(id)
  return { index, id }
}

test('una pregunta en lenguaje natural encuentra la sección aunque use otras flexiones', async ({}, testInfo) => {
  const { index, id } = await notebook(testInfo)
  try {
    const result = await index.search({ query: '¿Por qué no conviene borrar una sucursal que cerramos?', notebookId: id })
    expect(result.items[0].relativePath).toBe('Sucursales.md')
    expect(result.items[0].heading).toBe('Sucursales / Decisiones')
    expect(result.items[0].matchedTerms).toEqual(expect.arrayContaining(['borrar', 'sucursal']))
    const retiro = await index.search({ query: 'retiros fallidos reagendados', notebookId: id })
    expect(retiro.items[0].relativePath).toBe('Retiros.md')
  } finally { index.close() }
})

test('la respuesta señala los términos que no aparecen en ninguna nota', async ({}, testInfo) => {
  const { index, id } = await notebook(testInfo)
  try {
    const result = await index.search({ query: '¿Cómo se cobran los peajes de la caja?', notebookId: id })
    expect(result.terms).toEqual(['cobran', 'peajes', 'caja'])
    expect(result.missingTerms).toEqual(['cobran', 'peajes'])
    expect(result.items[0].relativePath).toBe('Caja.md')
  } finally { index.close() }
})

test('la sintaxis FTS5 hostil se busca como texto y no rompe la consulta', async ({}, testInfo) => {
  const { index, id } = await notebook(testInfo)
  try {
    for (const query of ['"caja', 'caja OR', 'NEAR(caja', 'caja*', '-caja', 'title:caja', '^caja', 'caja AND NOT', '""', '*', '¿?']) {
      const result = await index.search({ query, notebookId: id })
      if (/caja/i.test(query)) expect(result.items[0].relativePath).toBe('Caja.md')
      else expect(result.items).toEqual([])
    }
  } finally { index.close() }
})

test('los metadatos de una consulta larga respetan el presupuesto de caracteres', async ({}, testInfo) => {
  const { index, id } = await notebook(testInfo)
  try {
    const absent = Array.from({ length: 16 }, (_, n) => `inexistentepalabralarga${String.fromCharCode(97 + n)}`).join(' ')
    const empty = await index.search({ query: absent, notebookId: id, maxChars: 512 })
    expect(JSON.stringify(empty).length).toBeLessThanOrEqual(512)
    expect(empty.truncated).toBe(true)
    expect(empty.items).toEqual([])
    const mixed = await index.search({ query: `caja ${absent}`.slice(0, 512), notebookId: id, maxChars: 512 })
    expect(JSON.stringify(mixed).length).toBeLessThanOrEqual(512)
    expect(mixed.truncated).toBe(true)
    const short = await index.search({ query: 'caja', notebookId: id })
    expect(short).toMatchObject({ truncated: false, terms: ['caja'], missingTerms: [] })
  } finally { index.close() }
})
