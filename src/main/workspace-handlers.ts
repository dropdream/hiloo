import { dialog, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { maxDocumentBytes, type DocumentResult } from '../shared/documents'
import { markdownProblem } from '../shared/markdown'
import { buildNotebookIndex, isNotebookIndexUsage, notebookIndexFile } from '../shared/notebook-index'
import type { WorkspaceLinkResult, WorkspacePreviewResult } from '../shared/workspace'
import type { attachBrain } from './brain-service'
import { read, validatePath } from './document-io'
import type { DocumentActions } from './documents'
import type { createRecentHandlers } from './recent-handlers'
import {
  createWorkspace,
  pathKey,
  scanWorkspace,
  validateWorkspaceNote,
  withinWorkspace,
  workspaceCreationParent,
  workspaceEntryName,
  type WorkspaceSession
} from './workspace'

export function createWorkspaceHandlers(
  window: BrowserWindow,
  documents: DocumentActions,
  brain: ReturnType<typeof attachBrain>,
  recent: ReturnType<typeof createRecentHandlers>
) {
  let workspace: WorkspaceSession | null = null
  let workspaceGeneration = 0
  const { operation, confirmChanges, openPath, errorResult } = documents
  const emitWorkspace = () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('workspace:changed', workspace?.snapshot ?? null)
    }
    recent.emitWorkspaces()
  }

  async function refreshWorkspace(): Promise<void> {
    if (!workspace) return
    const active = workspace
    const generation = ++workspaceGeneration
    try {
      const next = await scanWorkspace(active, documents.current().path)
      if (workspace !== active || generation !== workspaceGeneration) return
      active.snapshot = next
      const warnings = await brain.refreshed(active.root)
      if (workspace !== active || generation !== workspaceGeneration) return
      active.snapshot.warnings.push(...warnings)
    } catch {
      if (workspace !== active || generation !== workspaceGeneration) return
      active.paths.clear()
      active.folders.clear()
      active.listing.complete = false
      active.snapshot = {
        ...active.snapshot,
        notes: [],
        folders: [],
        links: [],
        currentNoteId: null,
        warnings: ['No se pudo actualizar el cuaderno. Comprueba la carpeta y vuelve a actualizar.']
      }
    }
    emitWorkspace()
  }

  async function followDocument(): Promise<void> {
    const documentPath = documents.current().path
    if (!documentPath) return
    try {
      const actual = await fs.realpath(documentPath)
      if (!workspace || !withinWorkspace(workspace.root, actual)) {
        workspace = await createWorkspace(dirname(actual))
        workspaceGeneration++
      }
      await refreshWorkspace()
    } catch {
      if (workspace) {
        workspace.snapshot = {
          ...workspace.snapshot,
          warnings: ['El documento se conservó, pero no se pudo actualizar su cuaderno.']
        }
        emitWorkspace()
      }
    }
  }
  async function openWorkspace(path: string, revision: number): Promise<DocumentResult> {
    const next = await createWorkspace(path)
    const same = workspace && pathKey(workspace.root) === pathKey(next.root) ? workspace : null
    const owner = same ?? next
    const nextSnapshot = await scanWorkspace(owner, same ? documents.current().path : null)
    if (documents.current().revision !== revision)
      throw new Error('Llegaron cambios mientras se abría el cuaderno. La edición actual se conserva.')
    owner.snapshot = nextSnapshot
    workspace = owner
    workspaceGeneration++
    if (!same) {
      documents.reset()
    }
    try {
      await recent.rememberWorkspace(owner.root)
    } catch {
      owner.snapshot.warnings.push(
        'El cuaderno se abrió, pero no se pudo guardar su acceso en recientes para la próxima sesión.'
      )
    }
    owner.snapshot.warnings.push(...(await brain.opened(owner.root)))
    emitWorkspace()
    return { status: 'ok' }
  }

  return {
    current: () => workspace,
    followDocument,
    openPath: openWorkspace,
    currentSnapshot: () => workspace?.snapshot ?? null,
    create: (parentId: unknown, value: unknown, kind: unknown) => {
      const owner = workspace
      if (
        !owner ||
        typeof parentId !== 'string' ||
        (parentId !== owner.id && !owner.folders.has(parentId)) ||
        (kind !== 'folder' && kind !== 'note')
      ) {
        return { status: 'error', message: 'La carpeta o el tipo de elemento no pertenece al cuaderno actual.' }
      }
      let name: string
      try {
        name = workspaceEntryName(value, kind)
      } catch (error) {
        return errorResult(error)
      }
      return operation(async () => {
        const originalParent = parentId === owner.id ? owner.root : owner.folders.get(parentId)
        if (!originalParent) throw new Error('La carpeta seleccionada ya no está disponible.')
        await validateWorkspaceNote(owner, originalParent)
        if (kind === 'note' && !(await confirmChanges())) return { status: 'cancelled' }
        if (workspace !== owner)
          throw new Error('El cuaderno cambió durante el guardado. Selecciona la carpeta de nuevo.')
        const revision = documents.current().revision
        owner.snapshot = await scanWorkspace(owner, documents.current().path)
        emitWorkspace()
        const parent = await workspaceCreationParent(owner, parentId, kind)
        if (workspace !== owner || (kind === 'note' && documents.current().revision !== revision)) {
          throw new Error('Llegaron cambios durante la creación. La edición actual se conserva; vuelve a intentarlo.')
        }
        const target = join(parent, name)
        try {
          if (kind === 'folder') await fs.mkdir(target)
          else {
            const file = await fs.open(target, 'wx')
            await file.close()
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST')
            throw new Error('Ya existe un archivo o carpeta con ese nombre. Elegir otro nombre.')
          throw error
        }
        try {
          await validateWorkspaceNote(owner, target)
          if (workspace !== owner) throw new Error('El cuaderno cambió. Actualízalo antes de continuar.')
          if (kind === 'note') await openPath(target, revision, owner)
          else await refreshWorkspace()
          const createdId = owner.ids.get(pathKey(target))
          if (workspace !== owner || !createdId || !(kind === 'folder' ? owner.folders : owner.paths).has(createdId)) {
            throw new Error(
              'El elemento creado no aparece en el listado actualizado. Comprueba los avisos y los cambios externos del cuaderno.'
            )
          }
          return { status: 'ok' }
        } catch (error) {
          await refreshWorkspace()
          const result = errorResult(error)
          throw new Error(
            `Se creó ${name}, pero no se pudo completar su apertura o actualización. ${result.status === 'error' ? result.message : 'Actualiza el cuaderno.'}`
          )
        }
      })
    },
    createIndex: (workspaceId: unknown, usage: unknown) => {
      const owner = workspace
      if (!owner || typeof workspaceId !== 'string' || workspaceId !== owner.id || !isNotebookIndexUsage(usage)) {
        return { status: 'error', message: 'El cuaderno o el uso del índice no es válido.' }
      }
      return operation(async () => {
        if (!(await confirmChanges())) return { status: 'cancelled' }
        if (workspace !== owner)
          throw new Error('El cuaderno cambió durante el guardado. Selecciona la carpeta de nuevo.')
        const revision = documents.current().revision
        owner.snapshot = await scanWorkspace(owner, documents.current().path)
        emitWorkspace()
        if (owner.snapshot.hasIndex) throw new Error('El cuaderno ya tiene un índice. No se sobrescribió.')
        const parent = await workspaceCreationParent(owner, owner.id, 'note')
        if (workspace !== owner || documents.current().revision !== revision) {
          throw new Error('Llegaron cambios durante la creación. La edición actual se conserva; vuelve a intentarlo.')
        }
        const now = new Date()
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        const content = buildNotebookIndex({
          name: owner.snapshot.name,
          usage,
          date,
          notes: owner.snapshot.notes.map((note) => note.relativePath)
        })
        const problem = markdownProblem(content)
        if (problem) throw new Error(problem)
        if (Buffer.byteLength(content, 'utf8') > maxDocumentBytes)
          throw new Error('El índice supera el límite de 2 MB de esta entrega.')
        const target = join(parent, notebookIndexFile)
        try {
          await fs.writeFile(target, content, { encoding: 'utf8', flag: 'wx' })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST')
            throw new Error('Apareció un índice en el cuaderno. No se sobrescribió.')
          throw error
        }
        try {
          await validateWorkspaceNote(owner, target)
          if (workspace !== owner) throw new Error('El cuaderno cambió. Actualízalo antes de continuar.')
          await openPath(target, revision, owner)
          const createdId = owner.ids.get(pathKey(target))
          if (workspace !== owner || !createdId || !owner.paths.has(createdId)) {
            throw new Error(
              'El índice creado no aparece en el listado actualizado. Comprueba los avisos y los cambios externos del cuaderno.'
            )
          }
          return { status: 'ok' }
        } catch (error) {
          await refreshWorkspace()
          const result = errorResult(error)
          throw new Error(
            `Se creó ${notebookIndexFile}, pero no se pudo completar su apertura o actualización. ` +
              `${result.status === 'error' ? result.message : 'Actualiza el cuaderno.'}`
          )
        }
      })
    },
    linkTo: async (id: unknown): Promise<WorkspaceLinkResult> => {
      const owner = workspace
      const sourcePath = documents.current().path
      const sourceDocumentId = documents.current().id
      if (!sourcePath) return { status: 'error', message: 'Guarda esta nota antes de enlazar otra nota del cuaderno.' }
      if (
        !owner ||
        typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      ) {
        return { status: 'error', message: 'La nota seleccionada no pertenece al cuaderno actual.' }
      }
      const sourceNoteId = owner.snapshot.currentNoteId
      const sourceIndexedPath = sourceNoteId ? owner.paths.get(sourceNoteId) : null
      if (!sourceNoteId || !sourceIndexedPath || pathKey(sourceIndexedPath) !== pathKey(sourcePath)) {
        return {
          status: 'error',
          message: 'La nota actual no está en el listado del cuaderno. Actualízalo antes de crear el enlace.'
        }
      }
      const targetPath = owner.paths.get(id)
      const note = owner.snapshot.notes.find((entry) => entry.id === id)
      if (!targetPath || !note)
        return { status: 'error', message: 'La nota seleccionada no pertenece al cuaderno actual.' }
      if (id === sourceNoteId || pathKey(sourcePath) === pathKey(targetPath)) {
        return { status: 'error', message: 'Selecciona otra nota; no se puede enlazar la nota consigo misma.' }
      }
      try {
        validatePath(sourcePath)
        validatePath(targetPath)
        await Promise.all([validateWorkspaceNote(owner, sourcePath), validateWorkspaceNote(owner, targetPath)])
        const [sourceStat, targetStat] = await Promise.all([fs.lstat(sourcePath), fs.lstat(targetPath)])
        if (
          !sourceStat.isFile() ||
          sourceStat.isSymbolicLink() ||
          !targetStat.isFile() ||
          targetStat.isSymbolicLink()
        ) {
          throw new Error('El origen y el destino deben ser archivos Markdown normales, sin enlaces simbólicos.')
        }
        await Promise.all([validateWorkspaceNote(owner, sourcePath), validateWorkspaceNote(owner, targetPath)])
        if (
          workspace !== owner ||
          documents.current().id !== sourceDocumentId ||
          documents.current().path !== sourcePath ||
          owner.snapshot.currentNoteId !== sourceNoteId ||
          owner.paths.get(sourceNoteId) !== sourceIndexedPath ||
          owner.paths.get(id) !== targetPath
        ) {
          throw new Error(
            'El documento o el cuaderno cambió mientras se preparaba el enlace. Selecciona la nota de nuevo.'
          )
        }
        const href = relative(dirname(sourcePath), targetPath)
          .split(sep)
          .map((segment) => encodeURIComponent(segment))
          .join('/')
        return { status: 'ok', href, note }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          return {
            status: 'error',
            message: 'El origen o el destino ya no existe. Actualiza el cuaderno antes de crear el enlace.'
          }
        const failure = errorResult(error)
        return {
          status: 'error',
          message: failure.status === 'error' ? failure.message : 'No se pudo preparar el enlace.'
        }
      }
    },
    preview: async (id: unknown): Promise<WorkspacePreviewResult> => {
      const owner = workspace
      if (
        typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
        !owner
      ) {
        return { status: 'error', message: 'La nota seleccionada no pertenece al cuaderno actual.' }
      }
      const path = owner.paths.get(id)
      const note = owner.snapshot.notes.find((entry) => entry.id === id)
      if (!path || !note) return { status: 'error', message: 'La nota seleccionada no pertenece al cuaderno actual.' }
      try {
        validatePath(path)
        await validateWorkspaceNote(owner, path)
        const bytes = await read(path)
        if (!bytes) throw new Error('El archivo ya no existe. Actualizar el cuaderno.')
        await validateWorkspaceNote(owner, path)
        let content: string
        try {
          content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        } catch {
          throw new Error('El archivo no está codificado en UTF-8.')
        }
        if (content.includes('\0'))
          throw new Error('El archivo contiene datos binarios y no puede mostrarse como Markdown.')
        if (owner !== workspace || owner.paths.get(id) !== path)
          throw new Error('El cuaderno cambió mientras se preparaba la vista previa. Selecciona la nota de nuevo.')
        return { status: 'ok', note, content }
      } catch (error) {
        const failure = errorResult(error)
        return {
          status: 'error',
          message: failure.status === 'error' ? failure.message : 'No se pudo preparar la vista previa.'
        }
      }
    },
    refresh: () =>
      operation(async () => {
        await refreshWorkspace()
        return { status: 'ok' }
      }),
    choose: () =>
      operation(async () => {
        if (!(await confirmChanges())) return { status: 'cancelled' }
        const revision = documents.current().revision
        const selection = await dialog.showOpenDialog(window, {
          title: 'Abrir cuaderno',
          properties: ['openDirectory']
        })
        if (selection.canceled || !selection.filePaths[0]) return { status: 'cancelled' }
        return openWorkspace(selection.filePaths[0], revision)
      }),
    open: (id: unknown) => {
      if (typeof id !== 'string' || id.length > 100 || !workspace?.paths.has(id))
        return { status: 'error', message: 'La nota seleccionada no pertenece al cuaderno actual.' }
      return operation(async () => {
        const owner = workspace!
        const path = owner.paths.get(id)
        if (!path) throw new Error('La nota ya no está disponible. Actualizar el cuaderno.')
        if (!(await confirmChanges())) return { status: 'cancelled' }
        if (workspace !== owner) throw new Error('El cuaderno cambió durante el guardado. Selecciona la nota de nuevo.')
        return openPath(path, documents.current().revision, owner)
      })
    }
  }
}
