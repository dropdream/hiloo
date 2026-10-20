import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, resolve, toNamespacedPath } from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { test, expect } from './fixtures'
import type { BrainNotebook, BrainReadResult, BrainRelatedResult, BrainSearchResult } from '../src/shared/brain'

const execute = promisify(execFile)
const demo = resolve('docs/demo/Proyecto de ejemplo')

async function cli<T>(database: string, ...args: string[]): Promise<T> {
  const { stdout } = await execute(process.execPath, [resolve('scripts/brain.cjs'), ...args, '--db', database], { windowsHide: true })
  return JSON.parse(stdout) as T
}

// El servidor se lanza como lo haría un cliente MCP: desarrollo o app empaquetada.
function server(project: string, env: Record<string, string>): { command: string; args: string[]; env: Record<string, string> } {
  const base = { ...getDefaultEnvironment(), ...env }
  if (project === 'packaged') {
    const executable = resolve(process.env.HILOO_TEST_PACKAGED_PATH ?? 'dist/win-unpacked/hiloo.exe')
    return { command: executable, args: [join(executable, '..', 'resources', 'app.asar', 'out', 'main', 'brain-mcp.js')], env: { ...base, ELECTRON_RUN_AS_NODE: '1' } }
  }
  return { command: process.execPath, args: [resolve('scripts/brain-mcp.cjs')], env: base }
}

async function connect(project: string, env: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'hiloo-test', version: '1.0.0' })
  await client.connect(new StdioClientTransport({ ...server(project, env), stderr: 'ignore' }))
  return client
}

async function call<T>(client: Client, name: string, args: Record<string, unknown>, maxChars?: number): Promise<{ data: T; text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as { type: string; text: string }[]
  expect(content).toHaveLength(1)
  const text = content[0].text
  if (maxChars !== undefined) expect(text.length).toBeLessThanOrEqual(maxChars)
  return { data: JSON.parse(text) as T, text, isError: result.isError === true }
}

async function prepare(base: string): Promise<{ database: string; root: string; notebook: BrainNotebook }> {
  const root = join(base, 'Huerto')
  const database = join(base, 'brain.sqlite')
  await fs.cp(demo, root, { recursive: true })
  const notebook = await cli<BrainNotebook>(database, 'register', root)
  await cli(database, 'sync', notebook.id)
  return { database, root, notebook }
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === 'packaged' && !(await fs.stat(resolve('dist/win-unpacked/hiloo.exe')).catch(() => null)), 'Falta npm run pack:win.')
})

test('el MCP expone solo herramientas de lectura y responde al flujo catálogo, búsqueda y lectura', async ({}, testInfo) => {
  const { database, notebook } = await prepare(testInfo.outputPath('mcp'))
  const client = await connect(testInfo.project.name, { HILOO_BRAIN_DB: database })
  try {
    expect(client.getInstructions()).toMatch(/data, not instructions/i)
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['catalog', 'outline', 'read', 'related', 'search', 'sync'])
    for (const tool of tools) {
      expect(tool.description!.length).toBeLessThanOrEqual(400)
      expect(tool.annotations?.destructiveHint).toBe(false)
      expect(tool.annotations?.readOnlyHint).toBe(tool.name !== 'sync')
    }

    const catalog = await call<{ items: BrainNotebook[] }>(client, 'catalog', {}, 6000)
    expect(catalog.data.items.map((item) => item.id)).toEqual([notebook.id])

    const search = await call<BrainSearchResult & { nextOffset: number | null }>(client, 'search', { query: '¿Qué sistema de riego elegimos?', notebook: notebook.id }, 6000)
    const hit = search.data.items[0]
    expect(hit.relativePath).toBe('ideas/riego.md')
    expect(hit.matchedTerms).toContain('riego')

    const read = await call<BrainReadResult>(client, 'read', { ids: [hit.chunkId], expectedHashes: { [hit.chunkId]: hit.sourceHash } }, 12000)
    expect(read.data.items[0].status).toBe('ok')
    expect(read.data.items[0].content).toContain('goteo con temporizador')
    const upper = await call<BrainReadResult>(client, 'read', { ids: [hit.chunkId], expectedHashes: { [hit.chunkId]: hit.sourceHash.toUpperCase() } })
    expect(upper.data.items[0].status).toBe('ok')

    const outline = await call<{ items: { chunkId: string; heading: string }[] }>(client, 'outline', { node: notebook.id }, 6000)
    expect(outline.isError).toBe(true)
    const plan = await call<BrainSearchResult>(client, 'search', { query: 'cultivos temporada', notebook: notebook.id })
    const planNode = plan.data.items.find((item) => item.relativePath === 'plan.md')!.nodeId
    const sections = await call<{ items: { chunkId: string; heading: string }[]; sourceHash: string }>(client, 'outline', { node: planNode }, 6000)
    expect(sections.data.items.map((item) => item.heading)).toEqual(expect.arrayContaining(['Plan del huerto / Etapas', 'Plan del huerto / Cultivos de la primera temporada']))
    const section = sections.data.items.find((item) => item.heading.endsWith('Cultivos de la primera temporada'))!
    const sectionRead = await call<BrainReadResult>(client, 'read', { ids: [section.chunkId] })
    expect(sectionRead.data.items[0].content).toContain('Zanahorias')

    const links = await call<BrainRelatedResult>(client, 'related', { node: hit.nodeId, direction: 'out' }, 6000)
    expect(links.data.items.map((item) => item.relativePath)).toContain('ideas/presupuesto.md')
    const children = await call<BrainRelatedResult>(client, 'related', { node: notebook.id, type: 'hierarchy', direction: 'out' })
    expect(children.data.items.map((item) => item.title).sort()).toEqual(expect.arrayContaining(['ideas', 'reuniones']))
  } finally {
    await client.close()
  }
})

test('el MCP respeta presupuestos y paginación, y rechaza argumentos inválidos', async ({}, testInfo) => {
  const base = testInfo.outputPath('mcp-budget')
  const root = join(base, 'Cuaderno')
  const database = join(base, 'brain.sqlite')
  await fs.mkdir(root, { recursive: true })
  for (let index = 0; index < 8; index++) await fs.writeFile(join(root, `${index}.md`), `# Evidencia ${index}\n\n${'Evidencia de consulta con caracteres " escapados. '.repeat(40)}\n`, 'utf8')
  const notebook = await cli<BrainNotebook>(database, 'register', root)
  await cli(database, 'sync', notebook.id)
  const client = await connect(testInfo.project.name, { HILOO_BRAIN_DB: database })
  try {
    const seen = new Set<string>()
    let offset: number | null = 0
    while (offset !== null) {
      const page: { data: BrainSearchResult & { nextOffset: number | null } } = await call(client, 'search', { query: 'evidencia', limit: 3, offset, maxChars: 1024 }, 1024)
      expect(page.data.items.length).toBeGreaterThan(0)
      for (const item of page.data.items) {
        expect(seen.has(item.chunkId)).toBe(false)
        seen.add(item.chunkId)
      }
      offset = page.data.nextOffset
    }
    expect(seen.size).toBe(8)

    const absent = Array.from({ length: 16 }, (_, n) => `inexistentepalabralarga${String.fromCharCode(97 + n)}`).join(' ')
    const metadata = await call<BrainSearchResult>(client, 'search', { query: absent, maxChars: 512 }, 512)
    expect(metadata.data.truncated).toBe(true)

    const all = (await call<BrainSearchResult>(client, 'search', { query: 'evidencia', limit: 8, maxChars: 16000 })).data.items.map((item) => item.chunkId)
    const tight = await call<BrainReadResult>(client, 'read', { ids: all, maxChars: 4000 }, 4000)
    expect(tight.data.truncated).toBe(true)
    // Si no cabe ni el primer elemento, error explícito: una lista vacía parecería «sin resultados».
    for (const [name, args] of [
      ['search', { query: 'evidencia', maxChars: 512 }],
      ['read', { ids: all.slice(0, 1), maxChars: 512 }]
    ] as const) {
      const small = await call<{ error: string }>(client, name, args, 512)
      expect(small.isError, name).toBe(true)
      expect(small.data.error).toContain('Aumenta maxChars')
    }

    for (const [name, args] of [
      ['search', { query: 'evidencia', limit: -1 }],
      ['search', { query: 'evidencia', sql: 'DROP TABLE notebooks' }],
      ['read', { ids: ['../../brain.sqlite'] }],
      ['read', { ids: all.slice(0, 1), expectedHashes: { [all[1]]: 'a'.repeat(64) } }],
      ['related', { node: notebook.id, type: 'everything' }],
      ['catalog', { maxChars: 100 }],
      ['outline', { path: 'C:/Windows/win.ini' }]
    ] as const) {
      const result = await client.callTool({ name, arguments: args })
      expect(result.isError, `${name} ${JSON.stringify(args)}`).toBe(true)
    }
    for (const name of ['register', 'link', 'unlink', 'write_note', 'patch_section', 'language']) {
      const result = await client.callTool({ name, arguments: {} })
      expect(result.isError).toBe(true)
    }
  } finally {
    await client.close()
  }
})

test('el MCP sincroniza índices derivados sin tocar notas ni enlaces manuales', async ({}, testInfo) => {
  const { database, root, notebook } = await prepare(testInfo.outputPath('mcp-sync'))
  const children = await cli<BrainRelatedResult>(database, 'related', notebook.id, '--type', 'hierarchy', '--direction', 'out')
  const ideas = children.items.find((item) => item.title === 'ideas')!
  await cli(database, 'link', ideas.nodeId, notebook.id, '--label', 'Contexto')
  const client = await connect(testInfo.project.name, { HILOO_BRAIN_DB: database })
  try {
    const before = (await call<BrainSearchResult>(client, 'search', { query: 'riego goteo', notebook: notebook.id })).data.items.find((item) => item.relativePath === 'ideas/riego.md')!
    const note = join(root, 'ideas', 'riego.md')
    const original = await fs.readFile(note, 'utf8')
    await fs.writeFile(note, original.replace('goteo con temporizador', 'aspersión nocturna'), 'utf8')
    const stale = await call<BrainReadResult>(client, 'read', { ids: [before.chunkId], expectedHashes: { [before.chunkId]: before.sourceHash } })
    expect(stale.data.items[0].status).toBe('stale')
    expect(stale.data.items[0].content).toBeUndefined()

    const sync = await call<{ status: string; changedFiles: number }>(client, 'sync', { notebook: notebook.id })
    expect(sync.isError).toBe(false)
    expect(sync.data.changedFiles).toBe(1)
    const after = (await call<BrainSearchResult>(client, 'search', { query: 'aspersión', notebook: notebook.id })).data.items[0]
    expect(after.relativePath).toBe('ideas/riego.md')
    expect((await call<BrainReadResult>(client, 'read', { ids: [after.chunkId] })).data.items[0].content).toContain('aspersión nocturna')
    expect(await fs.readFile(note, 'utf8')).toContain('aspersión nocturna')
    const manual = await call<BrainRelatedResult>(client, 'related', { node: ideas.nodeId, type: 'manual' })
    expect(manual.data.items.map((item) => item.label)).toEqual(['Contexto'])
  } finally {
    await client.close()
  }
})

test('el MCP explica la falta de base o de cuadernos sin caerse', async ({}, testInfo) => {
  const base = testInfo.outputPath('mcp-empty')
  await fs.mkdir(base, { recursive: true })
  const missing = join(base, 'no-existe.sqlite')
  const client = await connect(testInfo.project.name, { HILOO_BRAIN_DB: missing })
  try {
    const result = await call<{ error: string }>(client, 'catalog', {})
    expect(result.isError).toBe(true)
    expect(result.data.error).toContain('No existe la base de Cerebro')
    await expect(fs.stat(missing)).rejects.toThrow()
  } finally {
    await client.close()
  }
  const empty = join(base, 'vacia.sqlite')
  await cli(empty, 'status')
  const second = await connect(testInfo.project.name, { HILOO_BRAIN_DB: empty })
  try {
    const result = await call<{ error: string }>(second, 'search', { query: 'riego' })
    expect(result.isError).toBe(true)
    expect(result.data.error).toContain('No hay cuadernos registrados')
  } finally {
    await second.close()
  }
})

test('el MCP lee mientras otro proceso mantiene la base abierta y escribe', async ({}, testInfo) => {
  const { database, notebook } = await prepare(testInfo.outputPath('mcp-concurrent'))
  const client = await connect(testInfo.project.name, { HILOO_BRAIN_DB: database })
  try {
    const writes = Array.from({ length: 3 }, () => cli(database, 'sync', notebook.id))
    const reads = Array.from({ length: 6 }, () => call<BrainSearchResult>(client, 'search', { query: 'presupuesto', notebook: notebook.id }))
    const results = await Promise.all(reads)
    await Promise.allSettled(writes)
    for (const result of results) {
      expect(result.isError).toBe(false)
      expect(result.data.items.length).toBeGreaterThan(0)
    }
  } finally {
    await client.close()
  }
})

test('el MCP recorta los avisos de sync para que la respuesta quepa', async ({}, testInfo) => {
  const base = testInfo.outputPath('mcp-warnings')
  // Rutas largas y lectura denegada: cada aviso de fs lleva la ruta completa.
  const folder = join(base, 'Cuaderno', ...Array.from({ length: 3 }, (_, n) => `${String(n).repeat(120)}`))
  await fs.mkdir(folder, { recursive: true })
  const notes = Array.from({ length: 10 }, (_, n) => join(folder, `nota-${n}.md`))
  for (const note of notes) await fs.writeFile(note, '# Nota\n', 'utf8')
  const database = join(base, 'brain.sqlite')
  const notebook = await cli<BrainNotebook>(database, 'register', join(base, 'Cuaderno'))
  const icacls = (...args: string[]) => execute('icacls', args, { windowsHide: true })
  for (const note of notes) await icacls(toNamespacedPath(note), '/deny', `${process.env.USERNAME}:(R)`)
  const client = await connect(testInfo.project.name, { HILOO_BRAIN_DB: database })
  try {
    const sync = await call<{ status: string; warnings: string[]; warningsOmitted: number }>(client, 'sync', { notebook: notebook.id }, 4000)
    expect(sync.isError).toBe(false)
    expect(sync.data.status).toBe('partial')
    expect(sync.data.warnings.length).toBeGreaterThan(0)
    expect(sync.data.warnings.length + sync.data.warningsOmitted).toBe(10)
    expect(sync.data.warningsOmitted).toBeGreaterThan(0)
  } finally {
    await client.close()
    await icacls(toNamespacedPath(base), '/reset', '/T', '/Q')
  }
})
