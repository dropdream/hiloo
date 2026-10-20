import { shell } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'
import type { DocumentLinkResult, DocumentResult } from '../shared/documents'
import { samePath } from './document-io'
import type { DocumentActions } from './documents'
import { withinWorkspace, type WorkspaceSession } from './workspace'

type ParsedLink =
  | { kind: 'anchor'; anchor: string }
  | { kind: 'external'; url: string }
  | { kind: 'local'; path: string; anchor: string | null }

const maxLinkLength = 8192
const notes = ['.md', '.markdown']

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

// Clasifica el destino sin tocar disco; null significa ignorar el enlace.
export function parseLink(href: string): ParsedLink | null {
  const value = href.trim()
  if (!value || value.length > maxLinkLength || /[\u0000-\u001f\u007f]/.test(value)) return null
  if (value.startsWith('#')) return { kind: 'anchor', anchor: decode(value.slice(1)) ?? value.slice(1) }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    if (!/^(https?:\/\/|mailto:)/i.test(value)) return null
    try {
      const url = new URL(value)
      if (url.protocol === 'mailto:' ? !url.pathname : !url.hostname) return null
      return { kind: 'external', url: url.href }
    } catch {
      return null
    }
  }
  if (value.startsWith('/') || value.startsWith('\\')) return null
  const hash = value.indexOf('#')
  const path = decode((hash < 0 ? value : value.slice(0, hash)).split('?', 1)[0])
  // Tras decodificar no se admiten unidades, flujos NTFS ni rutas absolutas o UNC.
  if (!path || /[\u0000-\u001f\u007f:*?"<>|]/.test(path) || path.startsWith('/') || path.startsWith('\\')) return null
  const fragment = hash < 0 ? null : value.slice(hash + 1)
  return { kind: 'local', path, anchor: fragment === null ? null : (decode(fragment) ?? fragment) }
}

export function createLinkHandlers(documents: DocumentActions, workspace: () => WorkspaceSession | null) {
  // Raíz permitida: el cuaderno de la nota o, si no hay, su carpeta.
  const rootFor = (documentPath: string) => {
    const owner = workspace()
    return owner && withinWorkspace(owner.root, documentPath) ? owner : null
  }

  async function locate(path: string, root: string): Promise<string> {
    if (!withinWorkspace(root, path)) throw new Error('El enlace apunta fuera del cuaderno y no se abrirá.')
    let real: string
    try {
      real = await fs.realpath(path)
    } catch {
      throw new Error(`No se encontró ${basename(path)}.`)
    }
    if (!withinWorkspace(await fs.realpath(root), real)) throw new Error('El enlace apunta fuera del cuaderno y no se abrirá.')
    return real
  }

  async function followLink(id: unknown, href: unknown): Promise<DocumentLinkResult> {
    const current = documents.current()
    if (id !== current.id || typeof href !== 'string') return { status: 'error', message: 'El enlace no es válido.' }
    const link = parseLink(href)
    if (!link) return { status: 'cancelled' }
    if (link.kind === 'anchor') return { status: 'anchor', anchor: link.anchor }
    try {
      if (link.kind === 'external') {
        await shell.openExternal(link.url)
        return { status: 'ok' }
      }
      if (!current.path) throw new Error('Guarda la nota para abrir sus enlaces relativos.')
      const root = rootFor(current.path)?.root ?? dirname(current.path)
      const path = await locate(resolve(dirname(current.path), link.path), root)
      const stat = await fs.stat(path)
      if (stat.isFile() && notes.includes(extname(path).toLowerCase())) {
        if (samePath(path, current.path)) return link.anchor ? { status: 'anchor', anchor: link.anchor } : { status: 'ok' }
        return { status: 'note', path, anchor: link.anchor }
      }
      // Nunca se abre ni se ejecuta: solo se muestra en el Explorador.
      shell.showItemInFolder(path)
      return { status: 'ok' }
    } catch (error) {
      return documents.errorResult(error)
    }
  }

  // La ruta llega del renderer: se valida otra vez antes de abrir.
  function openNote(id: unknown, path: unknown, target: unknown = 'current'): Promise<DocumentResult> | DocumentResult {
    const current = documents.current()
    if (
      id !== current.id ||
      (target !== 'current' && target !== 'new-tab') ||
      !current.path ||
      typeof path !== 'string' ||
      path.length > maxLinkLength ||
      !isAbsolute(path) ||
      !notes.includes(extname(path).toLowerCase())
    )
      return { status: 'error', message: 'La nota enlazada no es válida.' }
    const origin = current.path
    return documents.operation(async () => {
      const owner = rootFor(origin)
      const located = await locate(path, owner?.root ?? dirname(origin))
      // En pestaña nueva la nota de origen se conserva tal cual; no hay nada que confirmar.
      if (target === 'current' && !(await documents.confirmChanges())) return { status: 'cancelled' }
      if (documents.current().id !== id || documents.current().path !== origin)
        throw new Error('La nota cambió antes de seguir el enlace. Vuelve a intentarlo.')
      return documents.openPath(located, documents.current().revision, owner ?? undefined, target)
    })
  }

  return { followLink, openNote }
}
