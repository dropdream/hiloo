import { randomUUID } from 'node:crypto'
import { mkdirSync, promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { BrainCatalogRequest, BrainCatalogResult, BrainLinkRequest, BrainLinkResult, BrainNotebook, BrainReadItem, BrainReadRequest, BrainReadResult, BrainRelatedItem, BrainRelatedRequest, BrainRelatedResult, BrainSearchHit, BrainSearchRequest, BrainSearchResult, BrainStatus, BrainSyncResult } from '../../shared/brain'
import { createWorkspace, pathKey, validateWorkspaceNote, withinWorkspace, type WorkspaceSession } from '../workspace'
import { hash, parseDocument, parserVersion, chunkVersion } from './parse'
import { openDatabase, schemaVersion } from './schema'

const maxFileBytes = 2 * 1024 * 1024
const maxScanBytes = 32 * 1024 * 1024
const maxEntries = 10000
const maxNotes = 1000
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const tick = () => new Promise<void>((done) => setImmediate(done))
type Row = Record<string, string | number | null>
class LeaseLostError extends Error {}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('El límite de la consulta no es válido.')
  return value
}

function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('El identificador no es válido.')
}

function budget<T extends { items: unknown[]; truncated: boolean }>(result: T, item: T['items'][number], maxChars: number): boolean {
  result.items.push(item)
  if (JSON.stringify(result).length <= maxChars - 32) return true
  result.items.pop()
  result.truncated = true
  return false
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

export class BrainIndex {
  private readonly db: DatabaseSync
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  private readonly token = randomUUID()

  constructor(filePath: string) {
    if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true })
    this.db = openDatabase(filePath)
  }

  private assertOpen(): void { if (this.closed) throw new Error('El índice está cerrado.') }
  private rows(sql: string, ...values: SQLInputValue[]): Row[] { return this.db.prepare(sql).all(...values) as Row[] }
  private row(sql: string, ...values: SQLInputValue[]): Row | undefined { return this.db.prepare(sql).get(...values) as Row | undefined }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = action(); this.db.exec('COMMIT'); return result } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private notebook(value: Row): BrainNotebook {
    return { id: String(value.id), root: String(value.root), name: String(value.name), status: value.status as BrainNotebook['status'], indexedAt: value.indexed_at as string | null,
      nodeCount: Number(this.row('SELECT count(*) AS n FROM nodes WHERE notebook_id=? AND deleted=0', String(value.id))!.n),
      chunkCount: Number(this.row('SELECT count(*) AS n FROM chunks JOIN nodes ON nodes.id=chunks.node_id WHERE nodes.notebook_id=? AND nodes.deleted=0', String(value.id))!.n) }
  }

  async registerNotebook(root: string): Promise<BrainNotebook> {
    this.assertOpen()
    if (typeof root !== 'string' || !isAbsolute(root) || root.includes('\0') || root.length > 4096) throw new Error('Elegir una ruta absoluta de cuaderno válida.')
    const workspace = await createWorkspace(root)
    this.assertOpen()
    return this.transaction(() => {
      const existing = this.row('SELECT * FROM notebooks WHERE root_key=?', pathKey(workspace.root))
      if (existing) return this.notebook(existing)
      for (const owner of this.rows('SELECT root FROM notebooks')) {
        if (withinWorkspace(String(owner.root), workspace.root) || withinWorkspace(workspace.root, String(owner.root))) throw new Error('El cuaderno se solapa con una raíz ya registrada. Usa la raíz existente.')
      }
      const notebookId = randomUUID()
      const name = basename(workspace.root) || workspace.root
      this.db.prepare('INSERT INTO notebooks(id,root,root_key,name) VALUES(?,?,?,?)').run(notebookId, workspace.root, pathKey(workspace.root), name)
      this.db.prepare("INSERT INTO nodes(id,notebook_id,parent_id,kind,path,path_key,absolute_key,title) VALUES(?,?,NULL,'notebook','','',?,?)").run(notebookId, notebookId, pathKey(workspace.root), name)
      this.db.prepare("INSERT INTO jobs(notebook_id,state) VALUES(?,'pending')").run(notebookId)
      return this.notebook(this.row('SELECT * FROM notebooks WHERE id=?', notebookId)!)
    })
  }

  async catalog(request: BrainCatalogRequest = {}): Promise<BrainCatalogResult> {
    this.assertOpen()
    const limit = integer(request.limit, 20, 1, 100)
    const offset = integer(request.offset, 0, 0, 1000000)
    const maxChars = integer(request.maxChars, 6000, 512, 16000)
    const rows = this.rows('SELECT * FROM notebooks ORDER BY name COLLATE NOCASE,id LIMIT ? OFFSET ?', limit + 1, offset)
    const result: BrainCatalogResult = { items: [], truncated: rows.length > limit, nextOffset: null }
    let consumed = 0
    for (const row of rows.slice(0, limit)) {
      if (!budget(result, this.notebook(row), maxChars)) break
      consumed++
    }
    if (result.truncated && consumed === 0) throw new Error('El presupuesto no permite devolver el primer cuaderno. Aumenta maxChars.')
    if (result.truncated) result.nextOffset = offset + consumed
    return result
  }

  async status(): Promise<BrainStatus> {
    this.assertOpen()
    const count = (table: string, condition = '') => Number(this.row(`SELECT count(*) AS n FROM ${table} ${condition}`)!.n)
    return { schemaVersion, notebookCount: count('notebooks'), nodeCount: count('nodes', 'WHERE deleted=0'), chunkCount: count('chunks'),
      linkCount: count('links', 'WHERE target_id IS NOT NULL') + count('manual_links'), pendingJobs: count('jobs', "WHERE state IN ('pending','running','failed')") }
  }

  sync(notebookId: string): Promise<BrainSyncResult> {
    id(notebookId)
    this.assertOpen()
    const pending = this.queue.then(() => this.scan(notebookId))
    this.queue = pending.catch(() => {})
    return pending
  }

  private async readFile(owner: WorkspaceSession, path: string): Promise<{ source: string; hash: string; size: number; modified: number }> {
    await validateWorkspaceNote(owner, path)
    const stat = await fs.lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxFileBytes) throw new Error('Se omitió una nota no regular o mayor de 2 MiB.')
    const file = await fs.open(path, 'r')
    try {
      const before = await file.stat()
      if (!before.isFile() || before.size > maxFileBytes) throw new Error('La nota supera el límite de 2 MiB del índice.')
      const buffer = Buffer.alloc(before.size + 1)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      const after = await file.stat()
      if (bytesRead !== before.size || before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error('La nota cambió durante la lectura.')
      await validateWorkspaceNote(owner, path)
      const bytes = buffer.subarray(0, bytesRead)
      // Retrieval offsets use UTF-16 code units in this decoded string, without a UTF-8 BOM.
      const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (source.includes('\0')) throw new Error('Se omitió una nota con contenido binario.')
      return { source, hash: hash(bytes), size: bytesRead, modified: after.mtimeMs }
    } finally { await file.close() }
  }

  private putNode(notebookId: string, parentId: string, kind: 'folder' | 'note', path: string, root: string, generation: number): string {
    return this.transaction(() => {
      this.heartbeat(notebookId)
      const key = pathKey(path)
      const prior = this.row('SELECT id,kind FROM nodes WHERE absolute_key=?', key)
      const nodeId = prior ? String(prior.id) : randomUUID()
      const relativePath = relative(root, path).split(sep).join('/')
      if (prior && prior.kind !== kind) {
        this.db.prepare('DELETE FROM chunks WHERE node_id=?').run(nodeId)
        this.db.prepare('DELETE FROM links WHERE source_id=?').run(nodeId)
        this.db.prepare('UPDATE nodes SET source_hash=NULL,indexed_at=NULL WHERE id=?').run(nodeId)
      }
      this.db.prepare(`INSERT INTO nodes(id,notebook_id,parent_id,kind,path,path_key,absolute_key,title,seen_generation)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(absolute_key) DO UPDATE SET parent_id=excluded.parent_id,kind=excluded.kind,path=excluded.path,path_key=excluded.path_key,seen_generation=excluded.seen_generation,deleted=0`).run(nodeId, notebookId, parentId, kind, relativePath, relativePath.toLowerCase(), key, basename(path), generation)
      this.db.prepare('UPDATE links SET target_id=?,reason=NULL WHERE target_key=?').run(nodeId, key)
      return nodeId
    })
  }

  private heartbeat(notebookId: string, changedFiles?: number): void {
    const result = this.db.prepare("UPDATE jobs SET heartbeat=?,changed_files=coalesce(?,changed_files) WHERE notebook_id=? AND state='running' AND owner_token=?").run(Date.now(), changedFiles ?? null, notebookId, this.token)
    if (Number(result.changes) !== 1) throw new LeaseLostError('Otro proceso retomó la indexación del cuaderno.')
  }

  private async scan(notebookId: string): Promise<BrainSyncResult> {
    this.assertOpen()
    const notebook = this.row('SELECT * FROM notebooks WHERE id=?', notebookId)
    if (!notebook) throw new Error('El cuaderno no está registrado en Cerebro.')
    const generation = this.transaction(() => {
      const job = this.row('SELECT * FROM jobs WHERE notebook_id=?', notebookId)
      if (job?.state === 'running' && Number(job.heartbeat) > Date.now() - 30000 && alive(Number(job.owner_pid))) throw new Error('Este cuaderno ya se está indexando en otro proceso. Vuelve a intentarlo.')
      const next = Number(this.row('SELECT generation FROM notebooks WHERE id=?', notebookId)!.generation) + 1
      this.db.prepare('UPDATE notebooks SET generation=? WHERE id=?').run(next, notebookId)
      this.db.prepare("INSERT INTO jobs(notebook_id,state,owner_pid,owner_token,heartbeat,generation,changed_files) VALUES(?,'running',?,?,?,?,0) ON CONFLICT(notebook_id) DO UPDATE SET state='running',owner_pid=excluded.owner_pid,owner_token=excluded.owner_token,heartbeat=excluded.heartbeat,generation=excluded.generation,changed_files=0,error=NULL").run(notebookId, process.pid, this.token, Date.now(), next)
      return next
    })
    const warnings = new Set<string>()
    let complete = true
    let changedFiles = 0
    let removedNodes = 0
    let entries = 0
    let notes = 0
    let bytes = 0
    let owner: WorkspaceSession
    try { owner = await createWorkspace(String(notebook.root)) } catch {
      this.transaction(() => {
        this.heartbeat(notebookId, 0)
        this.db.prepare("UPDATE notebooks SET status='unavailable' WHERE id=?").run(notebookId)
        this.db.prepare("UPDATE jobs SET state='failed',error='Raíz no disponible' WHERE notebook_id=? AND owner_token=?").run(notebookId, this.token)
      })
      return { notebookId, status: 'unavailable', indexedAt: notebook.indexed_at as string | null, changedFiles: 0, removedNodes: 0, warnings: ['El cuaderno no está disponible. Su catálogo se conservó.'] }
    }
    try {
      const pending = [{ path: owner.root, id: notebookId, depth: 0 }]
      this.transaction(() => {
        this.heartbeat(notebookId)
        this.db.prepare('UPDATE nodes SET seen_generation=?,deleted=0 WHERE id=?').run(generation, notebookId)
      })
      while (pending.length && entries < maxEntries) {
        this.assertOpen()
        const directory = pending.pop()!
        try {
          await validateWorkspaceNote(owner, directory.path)
          const stream = await fs.opendir(directory.path)
          for await (const entry of stream) {
            this.assertOpen()
            if (++entries > maxEntries) { complete = false; break }
            if (entry.name.startsWith('.') || entry.name.toLowerCase() === 'node_modules' || entry.isSymbolicLink()) continue
            const path = resolve(directory.path, entry.name)
            if (entry.isDirectory()) {
              if (directory.depth >= 16) { complete = false; warnings.add('Se omitieron carpetas a más de 16 niveles.'); continue }
              await validateWorkspaceNote(owner, path)
              const nodeId = this.putNode(notebookId, directory.id, 'folder', path, owner.root, generation)
              pending.push({ path, id: nodeId, depth: directory.depth + 1 })
            } else if (entry.isFile() && ['.md', '.markdown'].includes(extname(path).toLowerCase())) {
              if (++notes > maxNotes || bytes >= maxScanBytes) { complete = false; warnings.add('Índice parcial: límite de 1.000 notas o 32 MiB por exploración.'); continue }
              const nodeId = this.putNode(notebookId, directory.id, 'note', path, owner.root, generation)
              try {
                const file = await this.readFile(owner, path)
                bytes += file.size
                if (bytes > maxScanBytes) { complete = false; warnings.add('Índice parcial: límite de lectura de 32 MiB.'); continue }
                const previous = this.row('SELECT source_hash,EXISTS(SELECT 1 FROM chunks WHERE node_id=nodes.id AND (parser_version<>? OR chunk_version<>?)) AS obsolete FROM nodes WHERE id=?', parserVersion, chunkVersion, nodeId)
                if (previous?.source_hash !== file.hash || previous.obsolete === 1) {
                  const parsed = parseDocument(file.source, basename(path))
                  if (parsed.partial) { complete = false; warnings.add('Se omitieron enlaces por superar 256 destinos en una nota.') }
                  const now = new Date().toISOString()
                  this.transaction(() => {
                    this.heartbeat(notebookId, changedFiles)
                    this.db.prepare('DELETE FROM chunks WHERE node_id=?').run(nodeId)
                    this.db.prepare('DELETE FROM links WHERE source_id=?').run(nodeId)
                    const insert = this.db.prepare('INSERT INTO chunks(id,node_id,ordinal,title,heading,path,body,start_offset,end_offset,source_hash,chunk_hash,parser_version,chunk_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
                    parsed.chunks.forEach((chunk, ordinal) => insert.run(randomUUID(), nodeId, ordinal, parsed.title, chunk.heading, relative(owner.root, path).split(sep).join('/'), chunk.body, chunk.start, chunk.end, file.hash, chunk.hash, parserVersion, chunkVersion))
                    for (const href of parsed.urls) {
                      try {
                        if (/^[a-z][a-z\d+.-]*:/i.test(href) || /^[\\/]/.test(href)) continue
                        const [raw, fragment = ''] = href.split('#', 2)
                        const decoded = decodeURIComponent(raw.split('?', 1)[0])
                        if (/[\u0000-\u001f\\:]/.test(decoded) || decoded.startsWith('/')) continue
                        const target = decoded ? resolve(dirname(path), decoded) : path
                        const key = pathKey(target)
                        const targetNode = this.row('SELECT id FROM nodes WHERE absolute_key=? AND deleted=0', key)
                        if (!this.row("SELECT id FROM links WHERE source_id=? AND target_key=? AND coalesce(fragment,'')=?", nodeId, key, fragment)) {
                          this.db.prepare('INSERT INTO links(source_id,target_id,target_key,fragment,source_hash,reason) VALUES(?,?,?,?,?,?)').run(nodeId, targetNode?.id ?? null, key, fragment || null, file.hash, targetNode ? null : 'missing')
                        }
                      } catch { /* Malformed URLs do not grant access to paths. */ }
                    }
                    this.db.prepare('UPDATE nodes SET title=?,source_hash=?,indexed_at=?,modified_at=?,byte_size=? WHERE id=?').run(parsed.title, file.hash, now, file.modified, file.size, nodeId)
                  })
                  changedFiles++
                }
              } catch (error) {
                if (error instanceof LeaseLostError) throw error
                complete = false
                warnings.add(error instanceof Error ? error.message : 'No se pudo indexar una nota.')
              }
              await tick()
            }
            if (entries % 20 === 0) { this.heartbeat(notebookId, changedFiles); await tick() }
          }
        } catch (error) {
          if (error instanceof LeaseLostError) throw error
          complete = false
          warnings.add(error instanceof Error ? error.message : 'No se pudo leer una carpeta.')
        }
      }
      if (pending.length || entries >= maxEntries) { complete = false; warnings.add('Índice parcial: límite de 10.000 entradas.') }
      await validateWorkspaceNote(owner, owner.root)
      const indexedAt = new Date().toISOString()
      this.transaction(() => {
        this.heartbeat(notebookId, changedFiles)
        if (complete) {
          const deleted = this.rows('SELECT id FROM nodes WHERE notebook_id=? AND seen_generation<>? AND deleted=0', notebookId, generation)
          removedNodes = deleted.length
          for (const node of deleted) {
            this.db.prepare('DELETE FROM chunks WHERE node_id=?').run(node.id)
            this.db.prepare('DELETE FROM links WHERE source_id=?').run(node.id)
            this.db.prepare("UPDATE links SET target_id=NULL,reason='missing' WHERE target_id=?").run(node.id)
          }
          this.db.prepare('UPDATE nodes SET deleted=1,source_hash=NULL,indexed_at=NULL WHERE notebook_id=? AND seen_generation<>?').run(notebookId, generation)
        }
        this.db.prepare('UPDATE notebooks SET status=?,indexed_at=? WHERE id=?').run(complete ? 'ready' : 'partial', indexedAt, notebookId)
        this.db.prepare("UPDATE jobs SET state=?,heartbeat=?,changed_files=?,error=? WHERE notebook_id=? AND owner_token=?").run(complete ? 'done' : 'pending', Date.now(), changedFiles, [...warnings].slice(0, 10).join(' '), notebookId, this.token)
      })
      return { notebookId, status: complete ? 'ready' : 'partial', indexedAt, changedFiles, removedNodes, warnings: [...warnings].slice(0, 10) }
    } catch (error) {
      this.db.prepare("UPDATE jobs SET state='failed',error=? WHERE notebook_id=? AND owner_token=?").run(error instanceof Error ? error.message : 'Indexación interrumpida', notebookId, this.token)
      throw error
    }
  }

  async search(request: BrainSearchRequest): Promise<BrainSearchResult> {
    this.assertOpen()
    if (!request || typeof request.query !== 'string' || request.query.length > 512) throw new Error('La búsqueda debe tener hasta 512 caracteres.')
    const limit = integer(request.limit, 6, 1, 20)
    const maxChars = integer(request.maxChars, 6000, 512, 16000)
    const terms = (request.query.match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 16)
    const result: BrainSearchResult = { items: [], truncated: false, indexedAt: null }
    if (!terms.length) return result
    let where = 'nodes.deleted=0'
    const args: SQLInputValue[] = [terms.map((term) => `"${term}"`).join(' AND ')]
    if (request.notebookId !== undefined) { id(request.notebookId); where += ' AND nodes.notebook_id=?'; args.push(request.notebookId) }
    if (request.ancestorId !== undefined) {
      id(request.ancestorId)
      const ancestor = this.row('SELECT notebook_id,path_key FROM nodes WHERE id=? AND deleted=0', request.ancestorId)
      if (!ancestor) return result
      where += ' AND nodes.notebook_id=? AND (nodes.id=? OR substr(nodes.path_key,1,?)=?)'
      const prefix = ancestor.path_key ? `${ancestor.path_key}/` : ''
      args.push(ancestor.notebook_id, request.ancestorId, prefix.length, prefix)
    }
    const rows = this.rows(`SELECT chunks.id AS chunkId,nodes.id AS nodeId,nodes.notebook_id AS notebookId,nodes.title,chunks.path AS relativePath,
      chunks.heading,snippet(chunks_fts,3,'','','…',48) AS excerpt,chunks.source_hash AS sourceHash,nodes.indexed_at AS indexedAt
      FROM chunks_fts JOIN chunks ON chunks.rowid=chunks_fts.rowid JOIN nodes ON nodes.id=chunks.node_id
      WHERE chunks_fts MATCH ? AND ${where} AND rank MATCH 'bm25(5.0, 3.0, 2.0, 1.0)' ORDER BY rank LIMIT 201`, ...args)
    const perNode = new Map<string, number>()
    for (const row of rows) {
      const nodeId = String(row.nodeId)
      if ((perNode.get(nodeId) ?? 0) >= 2) continue
      if (result.items.length >= limit) { result.truncated = true; break }
      const item = { ...row, excerpt: String(row.excerpt).slice(0, 350) } as unknown as BrainSearchHit
      if (!budget(result, item, maxChars)) break
      perNode.set(nodeId, (perNode.get(nodeId) ?? 0) + 1)
      if (!result.indexedAt || String(row.indexedAt) > result.indexedAt) result.indexedAt = String(row.indexedAt)
    }
    if (rows.length === 201) result.truncated = true
    return result
  }

  async read(request: BrainReadRequest): Promise<BrainReadResult> {
    this.assertOpen()
    if (!request || !Array.isArray(request.chunkIds) || request.chunkIds.length > 8) throw new Error('Lee hasta 8 fragmentos por solicitud.')
    request.chunkIds.forEach(id)
    const maxChars = integer(request.maxChars, 12000, 512, 32000)
    const result: BrainReadResult = { items: [], truncated: false }
    const checked = new Map<string, 'ok' | 'stale' | 'unavailable'>()
    for (const chunkId of [...new Set(request.chunkIds)]) {
      const row = this.row('SELECT chunks.*,nodes.notebook_id,nodes.deleted,notebooks.root FROM chunks JOIN nodes ON nodes.id=chunks.node_id JOIN notebooks ON notebooks.id=nodes.notebook_id WHERE chunks.id=?', chunkId)
      let item: BrainReadItem = { chunkId, nodeId: '', status: 'unavailable', relativePath: '', heading: '', sourceHash: '' }
      if (row && row.deleted === 0) {
        const nodeId = String(row.node_id)
        let status = checked.get(nodeId)
        if (!status) {
          try {
            const owner = await createWorkspace(String(row.root))
            const actual = await this.readFile(owner, resolve(owner.root, String(row.path)))
            status = actual.hash === row.source_hash ? 'ok' : 'stale'
          } catch { status = 'unavailable' }
          checked.set(nodeId, status)
        }
        const expected = request.expectedHashes?.[chunkId]
        if (expected !== undefined && expected !== row.source_hash) status = 'stale'
        item = { chunkId, nodeId, status, relativePath: String(row.path), heading: String(row.heading), sourceHash: String(row.source_hash) }
        if (status === 'ok') {
          const next = this.row('SELECT id FROM chunks WHERE node_id=? AND ordinal>? ORDER BY ordinal LIMIT 1', nodeId, row.ordinal)
          Object.assign(item, { content: String(row.body), startOffset: Number(row.start_offset), endOffset: Number(row.end_offset), nextChunkId: next ? String(next.id) : null })
        }
      }
      if (!budget(result, item, maxChars)) break
    }
    return result
  }

  async link(request: BrainLinkRequest): Promise<BrainLinkResult> {
    this.assertOpen()
    id(request?.sourceId)
    id(request?.targetId)
    const label = request.label ?? ''
    if (typeof label !== 'string' || label.length > 200 || /[\u0000-\u001f]/.test(label)) throw new Error('La relación admite una etiqueta de hasta 200 caracteres, sin caracteres de control.')
    return this.transaction(() => {
      for (const nodeId of [request.sourceId, request.targetId]) if (!this.row('SELECT id FROM nodes WHERE id=? AND deleted=0', nodeId)) throw new Error('El nodo ya no está disponible en el catálogo.')
      const linkId = randomUUID()
      this.db.prepare('INSERT OR IGNORE INTO manual_links(id,source_id,target_id,label,created_at) VALUES(?,?,?,?,?)').run(linkId, request.sourceId, request.targetId, label, new Date().toISOString())
      const saved = this.row('SELECT id FROM manual_links WHERE source_id=? AND target_id=? AND label=?', request.sourceId, request.targetId, label)!
      return { id: String(saved.id), sourceId: request.sourceId, targetId: request.targetId, label }
    })
  }

  async unlink(linkId: string): Promise<void> {
    this.assertOpen()
    id(linkId)
    this.db.prepare('DELETE FROM manual_links WHERE id=?').run(linkId)
  }

  async related(request: BrainRelatedRequest): Promise<BrainRelatedResult> {
    this.assertOpen()
    id(request?.nodeId)
    const limit = integer(request.limit, 20, 1, 100)
    const offset = integer(request.offset, 0, 0, 1000000)
    const maxChars = integer(request.maxChars, 6000, 512, 16000)
    const type = request.type ?? 'link'
    const direction = request.direction ?? 'both'
    if (!['link', 'hierarchy', 'manual'].includes(type) || !['in', 'out', 'both'].includes(direction)) throw new Error('El tipo o dirección de relación no es válido.')
    const result: BrainRelatedResult = { items: [], truncated: false, nextOffset: null }
    if (!this.row('SELECT id FROM nodes WHERE id=? AND deleted=0', request.nodeId)) return result
    const queries: string[] = []
    const args: SQLInputValue[] = []
    for (const side of ['in', 'out'] as const) {
      if (direction !== 'both' && direction !== side) continue
      const fields = `nodes.id AS nodeId,nodes.notebook_id AS notebookId,nodes.kind,nodes.title,nodes.path AS relativePath,'${type}' AS type,'${side}' AS direction`
      if (type === 'hierarchy') {
        queries.push(`SELECT ${fields},NULL AS fragment,NULL AS linkId,NULL AS label FROM nodes WHERE nodes.deleted=0 AND ${side === 'out' ? 'nodes.parent_id=?' : 'nodes.id=(SELECT parent_id FROM nodes WHERE id=?)'}`)
      } else {
        const table = type === 'manual' ? 'manual_links' : 'links'
        const target = side === 'out' ? 'target_id' : 'source_id'
        const origin = side === 'out' ? 'source_id' : 'target_id'
        queries.push(`SELECT ${fields},${type === 'manual' ? 'NULL' : 'edges.fragment'} AS fragment,${type === 'manual' ? 'edges.id' : 'NULL'} AS linkId,${type === 'manual' ? 'edges.label' : 'NULL'} AS label FROM ${table} edges JOIN nodes ON nodes.id=edges.${target} WHERE nodes.deleted=0 AND edges.${origin}=?`)
      }
      args.push(request.nodeId)
    }
    const rows = this.rows(`${queries.join(' UNION ALL ')} ORDER BY relativePath,nodeId,direction LIMIT ? OFFSET ?`, ...args, limit + 1, offset)
    result.truncated = rows.length > limit
    let consumed = 0
    for (const row of rows.slice(0, limit)) {
      const item = { ...row } as unknown as BrainRelatedItem
      if (row.linkId === null) delete item.linkId
      if (row.label === null) delete item.label
      if (!budget(result, item, maxChars)) break
      consumed++
    }
    if (result.truncated && consumed === 0) throw new Error('El presupuesto no permite devolver la primera relación. Aumenta maxChars.')
    if (result.truncated) result.nextOffset = offset + consumed
    return result
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    void this.queue.finally(() => this.db.close())
  }
}
