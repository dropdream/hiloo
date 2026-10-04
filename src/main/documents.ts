import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { maxDocumentBytes, type DocumentResult, type DocumentSnapshot } from '../shared/documents'
import { markdownProblem, safeImage } from '../shared/markdown'
import { validatePageSettings } from '../shared/printing'
import { printDocument } from './printing'

const maxImageBytes = 10 * 1024 * 1024

function imageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (bytes.toString('ascii', 0, 2) === 'BM') return 'image/bmp'
  if (bytes.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(bytes.toString('ascii', 8, 12))) return 'image/avif'
  return null
}

interface DocumentSession {
  id: string
  path: string | null
  original: Buffer | null
  source: string
  content: string
  bom: boolean
  crlf: boolean
  revision: number
  savedRevision: number
  updateError: string | null
}

export function attachDocuments(window: BrowserWindow, trustedUrl: string): void {
  let document: DocumentSession = { id: randomUUID(), path: null, original: null, source: '', content: '', bom: false, crlf: false, revision: 0, savedRevision: 0, updateError: null }
  let busy = false
  let allowClose = false
  let pendingFlush: { id: string; resolve(error: string | null): void } | null = null
  const channels: string[] = []
  const dirty = () => Boolean(document.updateError) || document.content !== document.source
  const snapshot = (): DocumentSnapshot => ({ id: document.id, name: document.path ? basename(document.path) : 'Sin título', content: document.content, savedContent: document.source, revision: document.revision, savedRevision: document.savedRevision, updateError: document.updateError, dirty: dirty(), hasFile: Boolean(document.path) })
  const emit = () => {
    window.setTitle(`${dirty() ? '• ' : ''}${snapshot().name} — hiloo`)
    window.webContents.send('document:changed', snapshot())
  }
  const setBusy = (value: boolean) => {
    busy = value
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('document:busy', value)
  }

  function validateSender(event: IpcMainInvokeEvent): void {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== trustedUrl) {
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

  function errorResult(error: unknown): DocumentResult {
    const code = (error as NodeJS.ErrnoException).code
    const message = code === 'EACCES' || code === 'EPERM'
      ? 'No hay permiso para acceder al archivo. Elegir otra ubicación con Guardar como.'
      : code === 'ENOSPC' ? 'No hay espacio disponible para guardar el archivo.'
        : code === 'EEXIST' ? 'Apareció un archivo en el destino. No se sobrescribió. Elegir otra ubicación con Guardar como.'
        : error instanceof Error ? error.message : 'No se pudo completar la operación.'
    return { status: 'error', message }
  }

  async function operation(action: () => Promise<DocumentResult>): Promise<DocumentResult> {
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
        pendingFlush = { id, resolve: (error) => { clearTimeout(timeout); pendingFlush = null; resolve(error) } }
        window.webContents.send('document:flush', id)
      })
      if (window.isDestroyed() || window.webContents.isDestroyed()) return { status: 'cancelled' }
      if (error) { document.updateError = error; document.revision++; emit(); throw new Error(error) }
      return await action()
    } catch (error) { return errorResult(error) } finally { setBusy(false) }
  }

  function validatePath(path: string): void {
    if (!['.md', '.markdown'].includes(extname(path).toLowerCase())) throw new Error('Elegir un archivo .md o .markdown.')
  }

  async function read(path: string): Promise<Buffer | null> {
    try {
      const stat = await fs.lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Elegir un archivo Markdown normal, sin enlaces simbólicos.')
      if (stat.size > maxDocumentBytes) throw new Error('El archivo supera el límite de 2 MB de esta entrega.')
      const bytes = await fs.readFile(path)
      if (bytes.length > maxDocumentBytes) throw new Error('El archivo supera el límite de 2 MB de esta entrega.')
      return bytes
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  const matches = (a: Buffer | null, b: Buffer | null) => a === null ? b === null : b !== null && a.equals(b)
  const samePath = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

  async function save(asCopy = false): Promise<DocumentResult> {
    if (document.updateError) throw new Error(document.updateError)
    let target = document.path
    if (!target || asCopy) {
      const selection = await dialog.showSaveDialog(window, {
        title: 'Guardar documento', defaultPath: target ?? 'Sin título.md',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
      })
      if (selection.canceled || !selection.filePath) return { status: 'cancelled' }
      target = selection.filePath
      if (!extname(target)) target += '.md'
    }
    validatePath(target)
    const isCurrent = document.path !== null && samePath(target, document.path)
    const expected = isCurrent ? document.original : await read(target)
    if (!matches(await read(target), expected)) throw new Error('El archivo cambió fuera de hiloo. No se sobrescribió. Usar Guardar como para conservar la edición en otra ubicación.')
    if (isCurrent && !dirty()) return { status: 'ok' }
    if (!isCurrent && expected) {
      const choice = await dialog.showMessageBox(window, { type: 'warning', message: `¿Reemplazar ${basename(target)}?`, detail: 'El archivo elegido ya existe.', buttons: ['Reemplazar', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true })
      if (choice.response !== 0) return { status: 'cancelled' }
    }
    if (document.updateError) throw new Error(document.updateError)
    // Versión inmutable que corresponde exactamente a los bytes de esta escritura.
    const writing = { ...document }
    const problem = markdownProblem(writing.content)
    if (problem) throw new Error(problem)
    const text = writing.crlf ? writing.content.replace(/\r?\n/g, '\r\n') : writing.content
    const bytes = writing.content === writing.source && writing.original ? writing.original : Buffer.from(`${writing.bom ? '\uFEFF' : ''}${text}`, 'utf8')
    if (bytes.length > maxDocumentBytes) throw new Error('El documento supera el límite de 2 MB de esta entrega.')
    const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
    try {
      const file = await fs.open(temp, 'wx')
      try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
      // Comprobación final antes de reemplazar el archivo.
      if (!matches(await read(target), expected)) throw new Error('El archivo cambió fuera de hiloo. No se sobrescribió. Usar Guardar como para conservar la edición en otra ubicación.')
      if (document.updateError) throw new Error(document.updateError)
      if (expected === null) {
        await fs.copyFile(temp, target, constants.COPYFILE_EXCL)
      } else {
        await fs.rename(temp, target)
      }
    } finally {
      await fs.unlink(temp).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    document = { ...document, path: target, original: bytes, source, savedRevision: writing.revision, content: document.revision === writing.revision ? source : document.content }
    emit()
    if (document.updateError) throw new Error(document.updateError)
    return { status: 'ok' }
  }

  async function confirmChanges(): Promise<boolean> {
    if (!dirty()) return true
    const revision = document.revision
    const choice = await dialog.showMessageBox(window, {
      type: 'question', message: `¿Guardar los cambios de ${snapshot().name}?`,
      detail: 'Los cambios sin guardar se perderán si se descartan.',
      buttons: ['Guardar', 'Descartar', 'Cancelar'], defaultId: 0, cancelId: 2, noLink: true
    })
    if (choice.response === 2) return false
    if (choice.response === 1) {
      if (revision !== document.revision) throw new Error('Llegaron cambios después de la confirmación. Revisar la edición antes de continuar.')
      return true
    }
    if ((await save()).status !== 'ok') return false
    if (dirty()) throw new Error('Se guardó una versión anterior, pero hay cambios posteriores pendientes. Guardar de nuevo antes de continuar.')
    return true
  }

  handle('document:current', () => snapshot())
  handle('document:image-source', async (id, source) => {
    if (id !== document.id || typeof source !== 'string' || source.length > 8192 || !safeImage(source)) return null
    const origin = source.trim()
    if (/^https?:\/\//i.test(origin)) return origin
    const documentPath = document.path
    if (!documentPath) return null
    try {
      const path = decodeURIComponent(origin.split(/[?#]/, 1)[0])
      const root = await fs.realpath(dirname(documentPath))
      const target = await fs.realpath(resolve(root, path))
      const fromRoot = relative(root, target)
      // Resolving symlinks first prevents a child directory from escaping the document folder.
      if (!fromRoot || isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) return null
      const file = await fs.open(target, 'r')
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > maxImageBytes) return null
        const bytes = Buffer.alloc(Math.min(stat.size + 1, maxImageBytes + 1))
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
        if (bytesRead > maxImageBytes || bytesRead !== stat.size) return null
        const content = bytes.subarray(0, bytesRead)
        const mime = imageMime(content)
        if (!mime || id !== document.id || documentPath !== document.path) return null
        return `data:${mime};base64,${content.toString('base64')}`
      } finally { await file.close() }
    } catch { return null }
  })
  handle('document:flushed', (id, error) => {
    if (!pendingFlush || id !== pendingFlush.id || (error !== null && typeof error !== 'string')) return { status: 'error', message: 'Confirmación de edición no válida.' }
    pendingFlush.resolve(typeof error === 'string' ? error.slice(0, 500) : null)
    return { status: 'ok' }
  })
  handle('document:update', (id, content) => {
    if (id !== document.id) return { status: 'error', message: 'El documento no es válido.' }
    document.revision++
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > maxDocumentBytes) {
      document.updateError = 'La última edición no pudo sincronizarse: el documento no es válido o supera el límite de 2 MB. Corregir la edición antes de guardar.'
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
  handle('document:print', (settings) => {
    if (!validatePageSettings(settings)) return { status: 'error', message: 'El formato de página no es válido. Usar medidas entre 50 y 1000 mm, con un decimal como máximo.' }
    return operation(async () => {
      if (document.updateError) throw new Error(document.updateError)
      const problem = markdownProblem(document.content)
      if (problem) throw new Error(problem)
      return printDocument(window, settings)
    })
  })
  handle('document:open', () => operation(async () => {
    if (!await confirmChanges()) return { status: 'cancelled' }
    const revision = document.revision
    const selection = await dialog.showOpenDialog(window, { title: 'Abrir Markdown', properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] })
    if (selection.canceled || !selection.filePaths[0]) return { status: 'cancelled' }
    const path = selection.filePaths[0]
    validatePath(path)
    const bytes = await read(path)
    if (!bytes) throw new Error('El archivo ya no existe.')
    let source: string
    try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error('El archivo no está codificado en UTF-8. Convertir una copia antes de abrir.') }
    if (source.includes('\0')) throw new Error('El archivo contiene datos binarios y no puede abrirse como Markdown.')
    const problem = markdownProblem(source)
    if (problem) throw new Error(problem)
    if (document.revision !== revision) throw new Error('Llegaron cambios mientras se abría el archivo. La edición actual se conserva; volver a abrir después de revisarla.')
    document = { id: randomUUID(), path, original: bytes, source, content: source, bom: bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])), crlf: source.includes('\r\n'), revision: 0, savedRevision: 0, updateError: null }
    emit()
    return { status: 'ok' }
  }))

  window.on('close', (event) => {
    if (allowClose) return
    event.preventDefault()
    void operation(async () => {
      if (!await confirmChanges()) return { status: 'cancelled' }
      const revision = document.revision
      setImmediate(() => {
        if (document.revision !== revision) {
          window.webContents.send('document:error', 'Llegaron cambios pendientes antes del cierre. La ventana permanece abierta.')
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
  window.webContents.once('destroyed', () => pendingFlush?.resolve('La ventana se cerró antes de confirmar la edición.'))
  window.once('closed', () => channels.forEach((channel) => ipcMain.removeHandler(channel)))
}
