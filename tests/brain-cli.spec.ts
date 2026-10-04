import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { test, expect } from './fixtures'
import type { BrainCatalogResult, BrainLinkResult, BrainNotebook, BrainReadResult, BrainRelatedResult, BrainSearchResult, BrainSyncResult } from '../src/shared/brain'

const execute = promisify(execFile)

async function command<T>(database: string, ...args: string[]): Promise<{ data: T; output: string }> {
  const { stdout } = await execute(process.execPath, [resolve('scripts/brain.cjs'), ...args, '--db', database], {
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 64 * 1024
  })
  return { data: JSON.parse(stdout) as T, output: stdout }
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'local', 'La CLI inicial se distribuye con el repositorio y Electron de desarrollo.')
})

test('la IA recupera secciones y conecta carpetas entre cuadernos sin abrir la interfaz', async ({}, testInfo) => {
  const base = testInfo.outputPath('brain')
  const database = join(base, 'brain.sqlite')
  const firstRoot = join(base, 'Trabajo')
  const secondRoot = join(base, 'Referencias')
  await fs.mkdir(join(firstRoot, 'Proyecto'), { recursive: true })
  await fs.mkdir(secondRoot, { recursive: true })
  await fs.writeFile(join(firstRoot, 'Proyecto', 'decision.md'), '# Decisión técnica\n\nElegimos SQLite por su almacenamiento local.\n\n## Motivos\n\nSin servidor adicional.\n\n[Guía](../../Referencias/guia.md)\n', 'utf8')
  await fs.writeFile(join(secondRoot, 'guia.md'), '# Guía\n\nLa referencia del proyecto.\n', 'utf8')
  const first = (await command<BrainNotebook>(database, 'register', firstRoot)).data
  const second = (await command<BrainNotebook>(database, 'register', secondRoot)).data
  await command(database, 'sync', second.id)
  await command(database, 'sync', first.id)

  const catalog = (await command<BrainCatalogResult>(database, 'catalog', '--limit', '1')).data
  expect(catalog.items).toHaveLength(1)
  expect(catalog.truncated).toBe(true)
  expect(catalog.nextOffset).toBe(1)
  const next = (await command<BrainCatalogResult>(database, 'catalog', '--offset', '1')).data
  expect(next.items).toHaveLength(1)
  expect(next.items[0].id).not.toBe(catalog.items[0].id)

  const children = (await command<BrainRelatedResult>(database, 'related', first.id, '--type', 'hierarchy', '--direction', 'out')).data
  const folder = children.items.find((item) => item.kind === 'folder')!
  expect(folder.title).toBe('Proyecto')
  const search = (await command<BrainSearchResult>(database, 'search', 'decision', '--ancestor', folder.nodeId)).data
  expect(search.items.length).toBeGreaterThan(0)
  const hit = search.items[0]
  expect(hit.title).toContain('Decisión')
  const read = (await command<BrainReadResult>(database, 'read', hit.chunkId, '--expected-hash', `${hit.chunkId}=${hit.sourceHash}`)).data
  expect(read.items[0].status).toBe('ok')
  expect(read.items[0].content).toContain('SQLite')
  expect(read.items[0].sourceHash).toBe(hit.sourceHash)

  const explicit = (await command<BrainRelatedResult>(database, 'related', hit.nodeId, '--type', 'link', '--direction', 'out')).data
  expect(explicit.items.some((item) => item.notebookId === second.id && item.title === 'Guía')).toBe(true)
  const link = (await command<BrainLinkResult>(database, 'link', folder.nodeId, second.id, '--label', 'Fuentes del proyecto')).data
  await command(database, 'sync', first.id)
  const manual = (await command<BrainRelatedResult>(database, 'related', second.id, '--type', 'manual', '--direction', 'in')).data
  expect(manual.items.some((item) => item.nodeId === folder.nodeId && item.linkId === link.id)).toBe(true)
  await command(database, 'unlink', link.id)
  const unlinked = (await command<BrainRelatedResult>(database, 'related', second.id, '--type', 'manual')).data
  expect(unlinked.items).toHaveLength(0)
})

test('la lectura detecta cambios externos y un cuaderno inaccesible no se interpreta como vacío', async ({}, testInfo) => {
  const base = testInfo.outputPath('brain-freshness')
  const root = join(base, 'Cuaderno')
  const database = join(base, 'brain.sqlite')
  await fs.mkdir(root, { recursive: true })
  const note = join(root, 'estado.md')
  await fs.writeFile(note, '# Estado\n\nPendiente alfa.\n', 'utf8')
  const notebook = (await command<BrainNotebook>(database, 'register', root)).data
  await command(database, 'sync', notebook.id)
  const before = (await command<BrainSearchResult>(database, 'search', 'alfa')).data.items[0]
  await fs.writeFile(note, '# Estado\n\nCompletado beta.\n', 'utf8')
  const stale = (await command<BrainReadResult>(database, 'read', before.chunkId, '--expected-hash', `${before.chunkId}=${before.sourceHash}`)).data
  expect(stale.items[0].status).toBe('stale')
  expect(stale.items[0].content).toBeUndefined()
  await command(database, 'sync', notebook.id)
  expect((await command<BrainSearchResult>(database, 'search', 'alfa')).data.items).toHaveLength(0)
  expect((await command<BrainSearchResult>(database, 'search', 'beta')).data.items).toHaveLength(1)
  await fs.rename(root, `${root}-offline`)
  const sync = (await command<BrainSyncResult>(database, 'sync', notebook.id)).data
  expect(sync.status).toBe('unavailable')
  const catalog = (await command<BrainCatalogResult>(database, 'catalog')).data
  expect(catalog.items[0].nodeCount).toBeGreaterThan(0)
  expect(catalog.items[0].status).toBe('unavailable')
})

test('la salida JSON respeta el presupuesto y rechaza argumentos de consulta ambiguos', async ({}, testInfo) => {
  const base = testInfo.outputPath('brain-budget')
  const root = join(base, 'Cuaderno')
  const database = join(base, 'brain.sqlite')
  await fs.mkdir(root, { recursive: true })
  for (let index = 0; index < 8; index++) await fs.writeFile(join(root, `${index}.md`), `# Evidencia ${index}\n\n${'Evidencia de consulta con caracteres " escapados. '.repeat(40)}\n`, 'utf8')
  const notebook = (await command<BrainNotebook>(database, 'register', root)).data
  await command(database, 'sync', notebook.id)
  const { data, output } = await command<BrainSearchResult>(database, 'search', 'evidencia', '--limit', '20', '--max-chars', '1024')
  expect(output.length).toBeLessThanOrEqual(1024)
  expect(data.truncated).toBe(true)
  expect(data.items.length).toBeGreaterThan(0)
  const seen = new Set<string>()
  let offset: number | null = 0
  while (offset !== null) {
    const page: { data: BrainRelatedResult; output: string } = await command<BrainRelatedResult>(database, 'related', notebook.id, '--type', 'hierarchy', '--direction', 'out', '--offset', String(offset), '--max-chars', '800')
    expect(page.output.length).toBeLessThanOrEqual(800)
    expect(page.data.items.length).toBeGreaterThan(0)
    for (const item of page.data.items) {
      expect(seen.has(item.nodeId)).toBe(false)
      seen.add(item.nodeId)
    }
    if (page.data.nextOffset !== null) expect(page.data.nextOffset).toBeGreaterThan(offset)
    offset = page.data.nextOffset
  }
  expect(seen.size).toBe(8)
  await expect(command(database, 'search', 'evidencia', '--limit', '-1')).rejects.toThrow()
  await expect(command(database, 'status', '--notebook', notebook.id)).rejects.toThrow()
})
