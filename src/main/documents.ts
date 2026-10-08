import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import {
  maxDocumentBytes,
  type DocumentPreviewResult,
  type DocumentPrintSnapshot,
  type DocumentResult,
  type DocumentSnapshot
} from '../shared/documents'
import { markdownProblem } from '../shared/markdown'
import { validatePageSettings, type PageSettings } from '../shared/printing'
import { previewDocument, printDocument } from './printing'
import { createRecentHandlers } from './recent-handlers'
import { createImageHandler } from './document-images'
import { read, matches, samePath, validatePath, writeDocument, type DocumentSession } from './document-io'
import { createWorkspaceHandlers } from './workspace-handlers'
import { attachBrain } from './brain-service'
import { validateWorkspaceNote, withinWorkspace, type WorkspaceSession } from './workspace'

export type DocumentOperation = <T extends DocumentResult>(
  action: () => Promise<T>
) => Promise<T | Exclude<DocumentResult, { status: 'ok' }>>

export interface DocumentActions {
  current(): DocumentSession
  reset(): void
  confirmChanges(): Promise<boolean>
  openPath(path: string, revision: number, owner?: WorkspaceSession): Promise<DocumentResult>
  operation: DocumentOperation
  errorResult(error: unknown): Extract<DocumentResult, { status: 'error' }>
}

export function attachDocuments(window: BrowserWindow, trustedUrl: string): void {
  let document: DocumentSession = {
    id: randomUUID(),
    path: null,
    original: null,
    source: '',
    content: '',
    bom: false,
    crlf: false,
    revision: 0,
    savedRevision: 0,
    updateError: null
  }
  let busy = false
  let allowClose = false
  let pendingFlush: {
    id: string
    resolve(error: string | null): void
  } | null = null
  let printPreview: (DocumentPrintSnapshot & { settings: PageSettings }) | null = null
  const brain = attachBrain(window, trustedUrl)
  const channels: string[] = []
  const dirty = () => Boolean(document.updateError) || document.content !== document.source
  const snapshot = (): DocumentSnapshot => ({
    id: document.id,
    name: document.path ? basename(document.path) : 'Sin título',
    content: document.content,
    savedContent: document.source,
    revision: document.revision,
    savedRevision: document.savedRevision,
    updateError: document.updateError,
    dirty: dirty(),
    hasFile: Boolean(document.path)
  })
  const emit = () => {
    window.setTitle(`${dirty() ? '• ' : ''}${snapshot().name} — hiloo`)
    window.webContents.send('document:changed', snapshot())
    recent.emitDocuments()
  }
  const documents: DocumentActions = {
    current: () => document,
    reset: () => {
      document = {
        id: randomUUID(),
        path: null,
        original: null,
        source: '',
        content: '',
        bom: false,
        crlf: false,
        revision: 0,
        savedRevision: 0,
        updateError: null
      }
      emit()
    },
    confirmChanges,
    openPath,
    operation,
    errorResult
  }
  const recent = createRecentHandlers(
    window,
    documents,
    () => workspaces.current(),
    (path, revision) => workspaces.openPath(path, revision)
  )
  const workspaces = createWorkspaceHandlers(window, documents, brain, recent)
  const imageSource = createImageHandler(documents.current)
  const setBusy = (value: boolean) => {
    busy = value
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('document:busy', value)
  }

  function validateSender(event: IpcMainInvokeEvent): void {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== trustedUrl
    ) {
      throw new Error('Origen de solicitud no permitido.')
    }
  }

  function handle(channel: string, callback: (...args: unknown[]) => unknown): void {
    channels.push(channel)
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      validateSender(event)
      return callback(...args)
    })
  }

  function errorResult(error: unknown): Extract<DocumentResult, { status: 'error' }> {
    const code = (error as NodeJS.ErrnoException).code
    const message =
      code === 'EACCES' || code === 'EPERM'
        ? 'No hay permiso para acceder al archivo. Elegir otra ubicación con Guardar como.'
        : code === 'ENOSPC'
          ? 'No hay espacio disponible para guardar el archivo.'
          : code === 'EEXIST'
            ? 'Apareció un archivo en el destino. No se sobrescribió. Elegir otra ubicación con Guardar como.'
            : error instanceof Error
              ? error.message
              : 'No se pudo completar la operación.'
    return { status: 'error', message }
  }

  async function operation<T extends DocumentResult>(
    action: () => Promise<T>
  ): Promise<T | Exclude<DocumentResult, { status: 'ok' }>> {
    if (busy) return { status: 'cancelled' }
    setBusy(true)
    try {
      // Barrera de edición: también cubre el cierre nativo y los IPC ya en cola.
      const error = await new Promise<string | null>((resolve) => {
        const id = randomUUID()
        const timeout = setTimeout(() => {
          pendingFlush = null
          resolve('No se pudo confirmar la edición pendiente. La operación se canceló.')
        }, 10_000)
        pendingFlush = {
          id,
          resolve: (error) => {
            clearTimeout(timeout)
            pendingFlush = null
            resolve(error)
          }
        }
        window.webContents.send('document:flush', id)
      })
      if (window.isDestroyed() || window.webContents.isDestroyed()) return { status: 'cancelled' }
      if (error) {
        document.updateError = error
        document.revision++
        emit()
        throw new Error(error)
      }
      return await action()
    } catch (error) {
      return errorResult(error)
    } finally {
      setBusy(false)
    }
  }

  async function save(asCopy = false): Promise<DocumentResult> {
    if (document.updateError) throw new Error(document.updateError)
    let target = document.path
    if (!target || asCopy) {
      const workspace = workspaces.current()
      const selection = await dialog.showSaveDialog(window, {
        title: 'Guardar documento',
        defaultPath: target ?? (workspace ? join(workspace.root, 'Sin título.md') : 'Sin título.md'),
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
      })
      if (selection.canceled || !selection.filePath) return { status: 'cancelled' }
      target = selection.filePath
      if (!extname(target)) target += '.md'
    }
    validatePath(target)
    const isCurrent = document.path !== null && samePath(target, document.path)
    const workspace = workspaces.current()
    const owner = isCurrent && workspace && withinWorkspace(workspace.root, target) ? workspace : null
    if (owner) await validateWorkspaceNote(owner, target)
    const expected = isCurrent ? document.original : await read(target)
    if (!matches(await read(target), expected))
      throw new Error(
        'El archivo cambió fuera de hiloo. No se sobrescribió. Usar Guardar como para conservar la edición en otra ubicación.'
      )
    if (isCurrent && !dirty()) {
      await workspaces.followDocument()
      return { status: 'ok' }
    }
    if (!isCurrent && expected) {
      const choice = await dialog.showMessageBox(window, {
        type: 'warning',
        message: `¿Reemplazar ${basename(target)}?`,
        detail: 'El archivo elegido ya existe.',
        buttons: ['Reemplazar', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      })
      if (choice.response !== 0) return { status: 'cancelled' }
    }
    if (document.updateError) throw new Error(document.updateError)
    // Versión inmutable que corresponde exactamente a los bytes de esta escritura.
    const writing = { ...document }
    const bytes = await writeDocument(target, writing, expected, owner, () => {
      if (document.updateError) throw new Error(document.updateError)
    })
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    document = {
      ...document,
      path: target,
      original: bytes,
      source,
      savedRevision: writing.revision,
      content: document.revision === writing.revision ? source : document.content
    }
    await recent.rememberDocument(target)
    emit()
    if (document.updateError) throw new Error(document.updateError)
    await workspaces.followDocument()
    return { status: 'ok' }
  }

  async function confirmChanges(): Promise<boolean> {
    if (!dirty()) return true
    const revision = document.revision
    const choice = await dialog.showMessageBox(window, {
      type: 'question',
      message: `¿Guardar los cambios de ${snapshot().name}?`,
      detail: 'Los cambios sin guardar se perderán si se descartan.',
      buttons: ['Guardar', 'Descartar', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    if (choice.response === 2) return false
    if (choice.response === 1) {
      if (revision !== document.revision)
        throw new Error('Llegaron cambios después de la confirmación. Revisar la edición antes de continuar.')
      return true
    }
    if ((await save()).status !== 'ok') return false
    if (dirty())
      throw new Error(
        'Se guardó una versión anterior, pero hay cambios posteriores pendientes. Guardar de nuevo antes de continuar.'
      )
    return true
  }

  async function openPath(path: string, revision: number, owner?: WorkspaceSession): Promise<DocumentResult> {
    validatePath(path)
    if (owner) await validateWorkspaceNote(owner, path)
    const bytes = await read(path)
    if (!bytes) throw new Error('El archivo ya no existe.')
    if (owner) await validateWorkspaceNote(owner, path)
    let source: string
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new Error('El archivo no está codificado en UTF-8. Convertir una copia antes de abrir.')
    }
    if (source.includes('\0')) throw new Error('El archivo contiene datos binarios y no puede abrirse como Markdown.')
    const problem = markdownProblem(source)
    if (problem) throw new Error(problem)
    if (document.revision !== revision)
      throw new Error(
        'Llegaron cambios mientras se abría el archivo. La edición actual se conserva; volver a abrir después de revisarla.'
      )
    document = {
      id: randomUUID(),
      path,
      original: bytes,
      source,
      content: source,
      bom: bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])),
      crlf: source.includes('\r\n'),
      revision: 0,
      savedRevision: 0,
      updateError: null
    }
    await recent.rememberDocument(path)
    emit()
    await workspaces.followDocument()
    return { status: 'ok' }
  }

  handle('workspace:recent', recent.listWorkspaces)
  handle('workspace:open-recent', recent.openWorkspace)
  handle('workspace:current', workspaces.currentSnapshot)
  handle('workspace:create', workspaces.create)
  handle('workspace:create-index', workspaces.createIndex)
  handle('workspace:link-to', workspaces.linkTo)
  handle('workspace:preview', workspaces.preview)
  handle('workspace:refresh', workspaces.refresh)
  handle('workspace:choose', workspaces.choose)
  handle('workspace:open', workspaces.open)

  handle('document:current', () => snapshot())
  handle('document:recent', recent.listDocuments)
  handle('document:open-recent', recent.openDocument)
  handle('document:image-source', imageSource)
  handle('document:flushed', (id, error) => {
    if (!pendingFlush || id !== pendingFlush.id || (error !== null && typeof error !== 'string'))
      return { status: 'error', message: 'Confirmación de edición no válida.' }
    pendingFlush.resolve(typeof error === 'string' ? error.slice(0, 500) : null)
    return { status: 'ok' }
  })
  handle('document:update', (id, content) => {
    if (id !== document.id) return { status: 'error', message: 'El documento no es válido.' }
    document.revision++
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > maxDocumentBytes) {
      document.updateError =
        'La última edición no pudo sincronizarse: el documento no es válido o supera el límite de 2 MB. Corregir la edición antes de guardar.'
      emit()
      return { status: 'error', message: document.updateError }
    }
    if (content.includes('\0')) {
      document.updateError =
        'La última edición contiene NUL y no pudo sincronizarse. Corrige la edición antes de guardar.'
      emit()
      return { status: 'error', message: document.updateError }
    }
    document.updateError = null
    document.content = content
    window.setTitle(`${dirty() ? '• ' : ''}${snapshot().name} — hiloo`)
    return { status: 'ok' }
  })
  handle('document:save', (asCopy) => {
    if (typeof asCopy !== 'boolean') return { status: 'error', message: 'Opción de guardado no válida.' }
    return operation(() => save(asCopy))
  })
  handle('document:print-preview', (settings): Promise<DocumentPreviewResult> | DocumentPreviewResult => {
    if (!validatePageSettings(settings))
      return {
        status: 'error',
        message: 'El formato de página no es válido. Usar medidas entre 50 y 1000 mm, con un decimal como máximo.'
      }
    return operation<DocumentPreviewResult>(async () => {
      printPreview = null
      if (document.updateError) throw new Error(document.updateError)
      const problem = markdownProblem(document.content)
      if (problem) throw new Error(problem)
      const snapshot = { documentId: document.id, revision: document.revision }
      const result = await previewDocument(window, settings)
      if (result.status !== 'ok') return result
      if (document.id !== snapshot.documentId || document.revision !== snapshot.revision)
        throw new Error('El documento cambió durante la vista previa. Vuelve a preparar la impresión.')
      printPreview = { ...snapshot, settings: { ...settings } }
      return { ...result, ...snapshot }
    })
  })
  handle('document:print', (settings, snapshot) => {
    if (!validatePageSettings(settings))
      return {
        status: 'error',
        message: 'El formato de página no es válido. Usar medidas entre 50 y 1000 mm, con un decimal como máximo.'
      }
    if (
      snapshot !== undefined &&
      (!snapshot ||
        typeof snapshot !== 'object' ||
        Array.isArray(snapshot) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(snapshot)) ||
        Object.keys(snapshot).length !== 2 ||
        !Object.keys(snapshot).every((key) => key === 'documentId' || key === 'revision') ||
        typeof (snapshot as DocumentPrintSnapshot).documentId !== 'string' ||
        !(snapshot as DocumentPrintSnapshot).documentId ||
        (snapshot as DocumentPrintSnapshot).documentId.length > 100 ||
        !Number.isSafeInteger((snapshot as DocumentPrintSnapshot).revision) ||
        (snapshot as DocumentPrintSnapshot).revision < 0)
    ) {
      return {
        status: 'error',
        message: 'La confirmación de impresión no es válida. Vuelve a preparar la vista previa.'
      }
    }
    return operation(async () => {
      if (snapshot !== undefined) {
        const confirmed = snapshot as DocumentPrintSnapshot
        if (
          !printPreview ||
          confirmed.documentId !== document.id ||
          confirmed.revision !== document.revision ||
          confirmed.documentId !== printPreview.documentId ||
          confirmed.revision !== printPreview.revision ||
          settings.format !== printPreview.settings.format ||
          settings.widthMm !== printPreview.settings.widthMm ||
          settings.heightMm !== printPreview.settings.heightMm
        ) {
          throw new Error('El documento o el formato cambió desde la vista previa. Vuelve a preparar la impresión.')
        }
      }
      if (document.updateError) throw new Error(document.updateError)
      const problem = markdownProblem(document.content)
      if (problem) throw new Error(problem)
      printPreview = null
      return printDocument(window, settings)
    })
  })
  handle('document:open', () =>
    operation(async () => {
      if (!(await confirmChanges())) return { status: 'cancelled' }
      const revision = document.revision
      const selection = await dialog.showOpenDialog(window, {
        title: 'Abrir Markdown',
        properties: ['openFile'],
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
      })
      if (selection.canceled || !selection.filePaths[0]) return { status: 'cancelled' }
      return openPath(selection.filePaths[0], revision)
    })
  )

  window.on('close', (event) => {
    if (allowClose) return
    event.preventDefault()
    void operation(async () => {
      if (!(await confirmChanges())) return { status: 'cancelled' }
      const revision = document.revision
      setImmediate(() => {
        if (document.revision !== revision) {
          window.webContents.send(
            'document:error',
            'Llegaron cambios pendientes antes del cierre. La ventana permanece abierta.'
          )
          return
        }
        allowClose = true
        window.close()
      })
      return { status: 'ok' }
    }).then((result) => {
      if (result.status === 'error' && !window.isDestroyed()) window.webContents.send('document:error', result.message)
    })
  })
  window.webContents.once('destroyed', () =>
    pendingFlush?.resolve('La ventana se cerró antes de confirmar la edición.')
  )
  window.once('closed', () => channels.forEach((channel) => ipcMain.removeHandler(channel)))
}
