import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { maxDocumentBytes } from '../shared/documents'
import { isNotebookIndexName } from '../shared/notebook-index'
import type { WorkspaceSnapshot } from '../shared/workspace'

const parser = unified().use(remarkParse).use(remarkGfm)
const maxNotes = 1000
const maxEntries = 10000
const maxScanBytes = 32 * 1024 * 1024
const maxLinks = 10000

export interface WorkspaceSession {
  id: string
  root: string
  ids: Map<string, string>
  paths: Map<string, string>
  folders: Map<string, string>
  listing: { entries: number; complete: boolean }
  snapshot: WorkspaceSnapshot
}

export const pathKey = (path: string) => resolve(path).toLowerCase()

export function withinWorkspace(root: string, path: string): boolean {
  const child = relative(root, path)
  return !isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`)
}

export async function createWorkspace(path: string): Promise<WorkspaceSession> {
  const stat = await fs.lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Elegir una carpeta normal, sin enlaces simbólicos.')
  const root = await fs.realpath(path)
  const id = randomUUID()
  return { id, root, ids: new Map(), paths: new Map(), folders: new Map(), listing: { entries: 0, complete: false }, snapshot: { id, name: basename(root) || root, notes: [], folders: [], links: [], currentNoteId: null, warnings: [], hasIndex: false } }
}

/** Revalidate every component: a previously indexed directory may have become a junction. */
export async function validateWorkspaceNote(workspace: WorkspaceSession, path: string): Promise<string> {
  if (!withinWorkspace(workspace.root, path)) throw new Error('La nota queda fuera de la carpeta seleccionada.')
  const root = await fs.realpath(workspace.root)
  if (pathKey(root) !== pathKey(workspace.root)) throw new Error('La carpeta seleccionada cambió de ubicación.')
  if ((await fs.lstat(workspace.root)).isSymbolicLink()) throw new Error('La carpeta seleccionada es un enlace simbólico.')
  let current = workspace.root
  for (const component of relative(workspace.root, path).split(sep).filter(Boolean)) {
    current = resolve(current, component)
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('No se abren notas mediante enlaces simbólicos.')
  }
  const real = await fs.realpath(path)
  if (!withinWorkspace(root, real)) throw new Error('La nota queda fuera de la carpeta seleccionada.')
  return real
}

export function workspaceEntryName(value: unknown, kind: 'folder' | 'note'): string {
  if (typeof value !== 'string' || !value || value.startsWith('.') || /[\u0000-\u001f\u007f<>:"/\\|?*]/.test(value) || /[. ]$/.test(value)) {
    throw new Error('Usa un nombre sin rutas, caracteres reservados ni punto o espacio final.')
  }
  const name = kind === 'note' && !/\.md$/i.test(value) ? `${value}.md` : value
  const device = name.split('.', 1)[0].trimEnd()
  if (name.length > 255 || /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(device)) {
    throw new Error('El nombre es demasiado largo o está reservado por Windows.')
  }
  if (kind === 'folder' && name.toLowerCase() === 'node_modules') throw new Error('La carpeta node_modules se excluye del cuaderno. Elegir otro nombre.')
  return name
}

export async function workspaceCreationParent(workspace: WorkspaceSession, id: string, kind: 'folder' | 'note'): Promise<string> {
  const path = id === workspace.id ? workspace.root : workspace.folders.get(id)
  if (!path) throw new Error('La carpeta seleccionada no pertenece al cuaderno actual.')
  const real = await validateWorkspaceNote(workspace, path)
  if (!(await fs.lstat(real)).isDirectory()) throw new Error('La carpeta seleccionada ya no está disponible.')
  const depth = relative(workspace.root, path).split(sep).filter(Boolean).length
  if (depth + (kind === 'folder' ? 1 : 0) > 16) throw new Error('El cuaderno admite carpetas hasta 16 niveles de profundidad.')
  if (!workspace.listing.complete || workspace.listing.entries >= maxEntries - 1 || (kind === 'note' && workspace.snapshot.notes.length >= maxNotes)) {
    throw new Error('No se puede crear en un cuaderno con listado incompleto o sin margen dentro de sus límites. Reduce su contenido y actualízalo.')
  }
  return real
}

interface MarkdownNode { type: string; url?: string; identifier?: string; children?: MarkdownNode[] }

function noteLinks(source: string): string[] {
  const tree = parser.parse(source) as MarkdownNode
  const definitions = new Map<string, string>()
  const references: string[] = []
  const urls: string[] = []
  const pending = [tree]
  while (pending.length) {
    const node = pending.pop()!
    if (node.type === 'link' && node.url) urls.push(node.url)
    if (node.type === 'definition' && node.identifier && node.url && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url)
    if (node.type === 'linkReference' && node.identifier) references.push(node.identifier)
    if (node.children) pending.push(...node.children.slice().reverse())
  }
  return urls.concat(references.flatMap((id) => definitions.has(id) ? [definitions.get(id)!] : []))
}

export async function scanWorkspace(workspace: WorkspaceSession, currentPath: string | null): Promise<WorkspaceSnapshot> {
  const notes: WorkspaceSnapshot['notes'] = []
  const folders: WorkspaceSnapshot['folders'] = []
  const paths = new Map<string, string>()
  const folderPaths = new Map<string, string>()
  const warnings = new Set<string>()
  const contents: { id: string; path: string; urls: string[] }[] = []
  let entries = 0
  let bytesRead = 0
  let complete = true
  let hasIndex = false
  const pending = [{ path: workspace.root, depth: 0 }]
  const root = await fs.realpath(workspace.root)
  if (pathKey(root) !== pathKey(workspace.root) || (await fs.lstat(root)).isSymbolicLink()) throw new Error('La carpeta seleccionada cambió de ubicación.')
  while (pending.length && entries < maxEntries) {
    const directory = pending.pop()!
    try {
      if (directory.depth > 16) { complete = false; warnings.add('Se omitieron carpetas a más de 16 niveles de profundidad.'); continue }
      if ((await fs.lstat(directory.path)).isSymbolicLink()) continue
      const real = await fs.realpath(directory.path)
      if (!withinWorkspace(root, real)) continue
      const stream = await fs.opendir(directory.path)
      for await (const entry of stream) {
        if (++entries > maxEntries) { complete = false; break }
        if (directory.depth === 0 && isNotebookIndexName(entry.name)) hasIndex = true
        if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name.toLowerCase() === 'node_modules') continue
        const path = resolve(directory.path, entry.name)
        if (entry.isDirectory()) {
          if (directory.depth >= 16) { complete = false; warnings.add('Se omitieron carpetas a más de 16 niveles de profundidad.'); continue }
          const key = pathKey(path)
          const id = workspace.ids.get(key) ?? randomUUID()
          workspace.ids.set(key, id)
          folderPaths.set(id, path)
          folders.push({ id, name: entry.name, relativePath: relative(root, path).split(sep).join('/') })
          pending.push({ path, depth: directory.depth + 1 })
          continue
        }
        if (!entry.isFile() || !['.md', '.markdown'].includes(extname(path).toLowerCase())) continue
        if (notes.length >= maxNotes) { complete = false; warnings.add('La lista es parcial: límite de 1.000 notas o 10.000 entradas exploradas.'); continue }
        const key = pathKey(path)
        const id = workspace.ids.get(key) ?? randomUUID()
        workspace.ids.set(key, id)
        paths.set(id, path)
        notes.push({ id, name: entry.name, relativePath: relative(root, path).split(sep).join('/') })
        try {
          if (bytesRead >= maxScanBytes) { warnings.add('El grafo es parcial: se alcanzó el límite de lectura de 32 MiB.'); continue }
          await validateWorkspaceNote(workspace, path)
          const file = await fs.open(path, 'r')
          try {
            const stat = await file.stat()
            if (!stat.isFile() || stat.size > maxDocumentBytes) { warnings.add('Se omitieron del grafo archivos mayores de 2 MiB o no regulares.'); continue }
            if (bytesRead + stat.size > maxScanBytes) { warnings.add('El grafo es parcial: se alcanzó el límite de lectura de 32 MiB.'); continue }
            const buffer = Buffer.alloc(Math.min(stat.size + 1, maxDocumentBytes + 1))
            const read = await file.read(buffer, 0, buffer.length, 0)
            bytesRead += read.bytesRead
            if (read.bytesRead !== stat.size) { warnings.add('Se omitieron del grafo archivos que cambiaron durante la lectura.'); continue }
            const source = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, read.bytesRead))
            if (source.includes('\0')) throw new Error('Contenido binario')
            contents.push({ id, path, urls: noteLinks(source) })
          } finally { await file.close() }
        } catch { warnings.add('No se pudieron analizar algunas notas; sus enlaces no aparecen en el grafo.') }
      }
    } catch {
      if (directory.path === workspace.root) throw new Error('No se pudo leer la carpeta seleccionada.')
      warnings.add('No se pudieron leer algunas subcarpetas.')
      complete = false
    }
  }
  if (entries >= maxEntries) { complete = false; warnings.add('La lista es parcial: límite de 1.000 notas o 10.000 entradas exploradas.') }
  const byPath = new Map([...paths].map(([id, path]) => [pathKey(path), id]))
  const links: WorkspaceSnapshot['links'] = []
  const seen = new Set<string>()
  for (const note of contents) {
    for (const url of note.urls) {
      try {
        const raw = url.split(/[?#]/, 1)[0]
        if (!raw || /^[a-z][a-z\d+.-]*:/i.test(raw) || /^[\\/]/.test(raw)) continue
        const decoded = decodeURIComponent(raw)
        if (!decoded || /[\u0000-\u001f\\:]/.test(decoded) || decoded.startsWith('/')) continue
        const target = byPath.get(pathKey(resolve(dirname(note.path), decoded)))
        if (!target || target === note.id) continue
        const key = `${note.id}:${target}`
        if (seen.has(key)) continue
        if (links.length >= maxLinks) { warnings.add('El grafo es parcial: límite de 10.000 conexiones.'); break }
        seen.add(key)
        links.push({ source: note.id, target })
      } catch { /* Invalid URL escapes do not represent a navigable note. */ }
    }
  }
  notes.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'es', { numeric: true }))
  folders.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'es', { numeric: true }))
  workspace.paths = paths
  workspace.folders = folderPaths
  workspace.listing = { entries, complete }
  return { id: workspace.id, name: workspace.snapshot.name, notes, folders, links, currentNoteId: currentPath ? byPath.get(pathKey(currentPath)) ?? null : null, warnings: [...warnings], hasIndex }
}
