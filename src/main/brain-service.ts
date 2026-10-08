import { app, ipcMain, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { BrainCatalogRequest, BrainLinkRequest, BrainReadRequest, BrainRelatedRequest, BrainSearchRequest } from '../shared/brain'
import { BrainIndex } from './brain'
import { pathKey } from './workspace'

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error('Solicitud de Cerebro no válida.')
  }
  return value as Record<string, unknown>
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error('Identificador de Cerebro no válido.')
  return value
}

function integer(value: unknown, min: number, max: number): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)) {
    throw new Error('Límite de Cerebro no válido.')
  }
}

function catalogRequest(value: unknown): BrainCatalogRequest {
  const request = object(value ?? {}, ['limit', 'offset', 'maxChars'])
  integer(request.limit, 1, 100)
  integer(request.offset, 0, 1_000_000)
  integer(request.maxChars, 512, 16_000)
  return request as BrainCatalogRequest
}

function searchRequest(value: unknown): BrainSearchRequest {
  const request = object(value, ['query', 'notebookId', 'ancestorId', 'limit', 'maxChars'])
  if (typeof request.query !== 'string' || !request.query.trim() || request.query.length > 512)
    throw new Error('La búsqueda debe contener entre 1 y 512 caracteres.')
  if (request.notebookId !== undefined) id(request.notebookId)
  if (request.ancestorId !== undefined) id(request.ancestorId)
  integer(request.limit, 1, 20)
  integer(request.maxChars, 512, 16_000)
  return request as unknown as BrainSearchRequest
}

function readRequest(value: unknown): BrainReadRequest {
  const request = object(value, ['chunkIds', 'maxChars', 'expectedHashes'])
  if (!Array.isArray(request.chunkIds) || request.chunkIds.length < 1 || request.chunkIds.length > 8) throw new Error('Solicita entre 1 y 8 fragmentos.')
  request.chunkIds.forEach(id)
  integer(request.maxChars, 512, 32_000)
  if (request.expectedHashes !== undefined) {
    const hashes = object(request.expectedHashes, request.chunkIds)
    if (Object.values(hashes).some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Versión de fragmento no válida.')
  }
  return request as unknown as BrainReadRequest
}

function relatedRequest(value: unknown): BrainRelatedRequest {
  const request = object(value, ['nodeId', 'direction', 'type', 'limit', 'offset', 'maxChars'])
  id(request.nodeId)
  if (request.direction !== undefined && !['in', 'out', 'both'].includes(String(request.direction))) throw new Error('Dirección de enlace no válida.')
  if (request.type !== undefined && !['link', 'hierarchy', 'manual'].includes(String(request.type))) throw new Error('Tipo de enlace no válido.')
  integer(request.limit, 1, 100)
  integer(request.offset, 0, 1_000_000)
  integer(request.maxChars, 512, 16_000)
  return request as unknown as BrainRelatedRequest
}

function linkRequest(value: unknown): BrainLinkRequest {
  const request = object(value, ['sourceId', 'targetId', 'label'])
  id(request.sourceId)
  id(request.targetId)
  if (request.label !== undefined && (typeof request.label !== 'string' || request.label.length > 200 || /[\u0000-\u001f]/.test(request.label)))
    throw new Error('La etiqueta del enlace no es válida.')
  return request as unknown as BrainLinkRequest
}

// Solo la selección explícita registra raíces; la vista envía IDs.
export function attachBrain(window: BrowserWindow, trustedUrl: string) {
  let index: BrainIndex | null = null
  let closed = false
  const channels: string[] = []
  const getIndex = () => {
    if (closed) throw new Error('Cerebro ya está cerrado.')
    return (index ??= new BrainIndex(join(app.getPath('userData'), 'brain.sqlite')))
  }
  function handle(channel: string, callback: (value: unknown) => unknown): void {
    channels.push(channel)
    ipcMain.handle(channel, (event, value: unknown) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== trustedUrl)
        throw new Error('Origen de solicitud no permitido.')
      return callback(value)
    })
  }
  handle('brain:catalog', (value) => getIndex().catalog(catalogRequest(value)))
  handle('brain:search', (value) => getIndex().search(searchRequest(value)))
  handle('brain:read', (value) => getIndex().read(readRequest(value)))
  handle('brain:related', (value) => getIndex().related(relatedRequest(value)))
  handle('brain:link', (value) => getIndex().link(linkRequest(value)))
  handle('brain:unlink', (value) => getIndex().unlink(id(value)))
  handle('brain:sync', (value) => getIndex().sync(id(value)))
  handle('brain:status', () => getIndex().status())

  window.once('closed', () => {
    closed = true
    channels.forEach((channel) => ipcMain.removeHandler(channel))
    index?.close()
  })

  return {
    async opened(root: string): Promise<string[]> {
      try {
        const brain = getIndex()
        const notebook = await brain.registerNotebook(root)
        const result = await brain.sync(notebook.id)
        return result.warnings
      } catch {
        return ['El cuaderno se abrió, pero no se pudo actualizar el índice de Cerebro.']
      }
    },
    async refreshed(root: string): Promise<string[]> {
      try {
        const brain = getIndex()
        let offset = 0
        while (true) {
          const page = await brain.catalog({ limit: 100, offset, maxChars: 16_000 })
          const notebook = page.items.find((entry) => pathKey(entry.root) === pathKey(root))
          if (notebook) return (await brain.sync(notebook.id)).warnings
          if (page.nextOffset === null || page.nextOffset <= offset) return []
          offset = page.nextOffset
        }
      } catch {
        return ['El documento se conservó, pero no se pudo actualizar el índice de Cerebro.']
      }
    }
  }
}
