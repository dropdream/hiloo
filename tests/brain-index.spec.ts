import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, expect } from './fixtures'
import { BrainIndex } from '../src/main/brain'
import type { BrainReadItem } from '../src/shared/brain'

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'local', 'Las pruebas del motor usan SQLite del runtime de pruebas; IPC y CLI verifican Electron.')
})

test('el índice conserva IDs y relaciones manuales al borrar y recuperar una nota', async ({}, testInfo) => {
  const root = testInfo.outputPath('cuaderno')
  await fs.mkdir(root, { recursive: true })
  const path = join(root, 'nota.md')
  await fs.writeFile(path, '# Árbol\n\nDecisión persistente.\n')
  const index = new BrainIndex(testInfo.outputPath('brain.sqlite'))
  try {
    const notebook = await index.registerNotebook(root)
    expect(await index.registerNotebook(root.toUpperCase())).toEqual(notebook)
    expect((await index.sync(notebook.id)).changedFiles).toBe(1)
    const first = (await index.search({ query: 'arbol' })).items[0]
    const link = await index.link({ sourceId: notebook.id, targetId: first.nodeId, label: 'Decisiones' })
    expect((await index.sync(notebook.id)).changedFiles).toBe(0)
    expect((await index.search({ query: 'arbol' })).items[0].chunkId).toBe(first.chunkId)
    await fs.unlink(path)
    expect((await index.sync(notebook.id)).removedNodes).toBe(1)
    expect((await index.search({ query: 'arbol' })).items).toEqual([])
    expect((await index.related({ nodeId: notebook.id, type: 'manual' })).items).toEqual([])
    await fs.writeFile(path, '# Árbol\n\nDecisión persistente.\n')
    expect((await index.sync(notebook.id)).changedFiles).toBe(1)
    const restored = (await index.search({ query: 'arbol' })).items[0]
    expect(restored.nodeId).toBe(first.nodeId)
    expect((await index.related({ nodeId: notebook.id, type: 'manual' })).items[0].linkId).toBe(link.id)
  } finally { index.close() }
})

test('un scan parcial conserva notas ausentes y las lecturas verifican hash y límites JSON', async ({}, testInfo) => {
  const root = testInfo.outputPath('cuaderno')
  await fs.mkdir(root, { recursive: true })
  const path = join(root, 'nota.md')
  await fs.writeFile(path, '# Información\n\nContenido que cambia.\n')
  const index = new BrainIndex(testInfo.outputPath('brain.sqlite'))
  try {
    const notebook = await index.registerNotebook(root)
    await index.sync(notebook.id)
    const hit = (await index.search({ query: 'informacion' })).items[0]
    const read = await index.read({ chunkIds: [hit.chunkId], expectedHashes: { [hit.chunkId]: hit.sourceHash }, maxChars: 1024 })
    expect(read.items[0].status).toBe('ok')
    expect(JSON.stringify(read).length).toBeLessThanOrEqual(1024)
    await fs.writeFile(path, '# Información\n\nTexto cambiado.\n')
    const stale = await index.read({ chunkIds: [hit.chunkId] })
    expect(stale.items[0].status).toBe('stale')
    expect(stale.items[0].content).toBeUndefined()
    await fs.unlink(path)
    await fs.writeFile(join(root, 'demasiado-grande.md'), 'x'.repeat(2 * 1024 * 1024 + 1))
    const partial = await index.sync(notebook.id)
    expect(partial.status).toBe('partial')
    expect(partial.removedNodes).toBe(0)
    expect((await index.search({ query: 'informacion' })).items[0].nodeId).toBe(hit.nodeId)
    expect((await index.read({ chunkIds: [hit.chunkId] })).items[0].status).toBe('unavailable')
    expect(JSON.stringify(await index.search({ query: 'informacion', maxChars: 512 })).length).toBeLessThanOrEqual(512)
    await fs.mkdir(join(root, 'subcarpeta'))
    await expect(index.registerNotebook(join(root, 'subcarpeta'))).rejects.toThrow('solapa')
  } finally { index.close() }
})

test('los enlaces truncados mantienen el índice parcial tras sincronizar y reiniciar', async ({}, testInfo) => {
  const root = testInfo.outputPath('cuaderno')
  const database = testInfo.outputPath('brain.sqlite')
  await fs.mkdir(root, { recursive: true })
  const path = join(root, 'enlaces.md')
  await fs.writeFile(path, Array.from({ length: 257 }, (_, n) => `[Nota ${n}](nota-${n}.md)`).join('\n'))
  const first = new BrainIndex(database)
  let notebookId: string
  try {
    notebookId = (await first.registerNotebook(root)).id
    const initial = await first.sync(notebookId)
    expect(initial.status).toBe('partial')
    expect(initial.warnings).toContain('Se omitieron enlaces por superar 256 destinos en una nota.')
    const repeated = await first.sync(notebookId)
    expect(repeated.status).toBe('partial')
    expect(repeated.changedFiles).toBe(0)
    expect(repeated.warnings).toEqual(initial.warnings)
  } finally { first.close() }
  const restarted = new BrainIndex(database)
  try {
    expect((await restarted.sync(notebookId!)).status).toBe('partial')
    expect((await restarted.catalog()).items[0].status).toBe('partial')
    await fs.writeFile(path, '[Una nota](nota-0.md)\n')
    expect((await restarted.sync(notebookId!)).status).toBe('ready')
    expect((await restarted.sync(notebookId!)).warnings).toEqual([])
  } finally { restarted.close() }
})

test('migrar un índice anterior conserva identidades y recalcula el estado parcial', async ({}, testInfo) => {
  const root = testInfo.outputPath('cuaderno')
  const database = testInfo.outputPath('brain.sqlite')
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(join(root, 'enlaces.md'), '# Enlaces\n\n' + Array.from({ length: 257 }, (_, n) => `[Nota ${n}](nota-${n}.md)`).join('\n'))
  const first = new BrainIndex(database)
  const notebook = await first.registerNotebook(root)
  await first.sync(notebook.id)
  const hit = (await first.search({ query: 'enlaces' })).items[0]
  const link = await first.link({ sourceId: notebook.id, targetId: hit.nodeId })
  first.close()
  await new Promise<void>((done) => setImmediate(done))
  const old = new DatabaseSync(database)
  try {
    old.exec('ALTER TABLE nodes DROP COLUMN links_partial; PRAGMA user_version=1;')
  } finally { old.close() }
  const migrated = new BrainIndex(database)
  try {
    expect((await migrated.status()).schemaVersion).toBe(2)
    expect((await migrated.catalog()).items[0].id).toBe(notebook.id)
    expect((await migrated.sync(notebook.id)).status).toBe('partial')
    expect((await migrated.search({ query: 'enlaces' })).items[0].nodeId).toBe(hit.nodeId)
    expect((await migrated.related({ nodeId: notebook.id, type: 'manual' })).items[0].linkId).toBe(link.id)
  } finally { migrated.close() }
})

test('jobs se reclaman atómicamente y se retoman tras un dueño desaparecido', async ({}, testInfo) => {
  const root = testInfo.outputPath('cuaderno')
  const database = testInfo.outputPath('brain.sqlite')
  await fs.mkdir(root, { recursive: true })
  for (let n = 0; n < 20; n++) await fs.writeFile(join(root, `nota-${n}.md`), `# Nota ${n}\n\nTexto para indexar.\n`)
  const first = new BrainIndex(database)
  const second = new BrainIndex(database)
  try {
    const notebook = await first.registerNotebook(root)
    const results = await Promise.allSettled([first.sync(notebook.id), second.sync(notebook.id)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const inspect = new DatabaseSync(database)
    try {
      inspect.prepare("UPDATE jobs SET state='running',owner_pid=?,heartbeat=?,owner_token='dead' WHERE notebook_id=?").run(2147483647, Date.now(), notebook.id)
    } finally { inspect.close() }
    expect((await second.sync(notebook.id)).status).toBe('ready')
    expect((await second.status()).pendingJobs).toBe(0)
  } finally { first.close(); second.close() }
})

test('los rangos usan UTF-16 sin BOM y no dividen pares sustitutos', async ({}, testInfo) => {
  const root = testInfo.outputPath('cuaderno')
  await fs.mkdir(root, { recursive: true })
  const source = '\uFEFF# Información\r\n\r\n' + 'Texto con 😀 y á. '.repeat(250)
  await fs.writeFile(join(root, 'unicode.md'), source, 'utf8')
  const index = new BrainIndex(testInfo.outputPath('brain.sqlite'))
  try {
    const notebook = await index.registerNotebook(root)
    await index.sync(notebook.id)
    const hit = (await index.search({ query: 'informacion' })).items[0]
    let chunkId: string | null = hit.chunkId
    let visited = 0
    while (chunkId) {
      const chunk: BrainReadItem = (await index.read({ chunkIds: [chunkId] })).items[0]
      expect(chunk.status).toBe('ok')
      expect(chunk.content).toBe(source.slice(1).slice(chunk.startOffset, chunk.endOffset))
      expect(chunk.content).not.toMatch(/^[\uDC00-\uDFFF]/)
      expect(chunk.content).not.toMatch(/[\uD800-\uDBFF]$/)
      visited++
      chunkId = chunk.nextChunkId ?? null
    }
    expect(visited).toBeGreaterThan(1)
  } finally { index.close() }
})

test('FTS y relaciones usan índices y un commit fallido no mezcla hashes ni fragmentos', async ({}, testInfo) => {
  const root = testInfo.outputPath('cuaderno')
  const database = testInfo.outputPath('brain.sqlite')
  await fs.mkdir(root, { recursive: true })
  const path = join(root, 'nota.md')
  await fs.writeFile(path, '# Original\n\nAntes del cambio.\n')
  const index = new BrainIndex(database)
  const inspect = new DatabaseSync(database)
  try {
    const notebook = await index.registerNotebook(root)
    await index.sync(notebook.id)
    const original = (await index.search({ query: 'original' })).items[0]
    inspect.exec("CREATE TRIGGER reject_test_chunk BEFORE INSERT ON chunks BEGIN SELECT RAISE(ABORT,'forced rollback'); END")
    await fs.writeFile(path, '# Nuevo\n\nDespués del cambio.\n')
    expect((await index.sync(notebook.id)).status).toBe('partial')
    expect((await index.search({ query: 'original' })).items[0].sourceHash).toBe(original.sourceHash)
    expect((await index.search({ query: 'nuevo' })).items).toEqual([])
    expect((await index.read({ chunkIds: [original.chunkId] })).items[0].status).toBe('stale')
    inspect.exec('DROP TRIGGER reject_test_chunk')
    expect((await index.sync(notebook.id)).changedFiles).toBe(1)
    expect((await index.search({ query: 'original' })).items).toEqual([])
    const plans = {
      fts: inspect.prepare('EXPLAIN QUERY PLAN SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT 20').all('nuevo'),
      hierarchy: inspect.prepare('EXPLAIN QUERY PLAN SELECT id FROM nodes WHERE parent_id=? AND deleted=0').all(notebook.id),
      backlinks: inspect.prepare('EXPLAIN QUERY PLAN SELECT source_id FROM links WHERE target_id=?').all(notebook.id),
      resolution: inspect.prepare('EXPLAIN QUERY PLAN SELECT id FROM links WHERE target_key=?').all(path.toLowerCase())
    }
    await fs.writeFile(testInfo.outputPath('sqlite-query-plans.json'), JSON.stringify({ sqlite: inspect.prepare('SELECT sqlite_version() AS version').get(), plans }, null, 2))
    expect(JSON.stringify(plans.fts)).toContain('VIRTUAL TABLE INDEX')
    expect(JSON.stringify(plans.hierarchy)).toContain('nodes_parent')
    expect(JSON.stringify(plans.backlinks)).toContain('links_target')
    expect(JSON.stringify(plans.resolution)).toContain('links_target_key')
    expect(inspect.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(inspect.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok')
  } finally { inspect.close(); index.close() }
})
