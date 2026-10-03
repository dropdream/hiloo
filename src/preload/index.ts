import { contextBridge, ipcRenderer } from 'electron'
import type { DocumentBridge, DocumentSnapshot } from '../shared/documents'

const api: DocumentBridge = {
  current: () => ipcRenderer.invoke('document:current'),
  open: () => ipcRenderer.invoke('document:open'),
  save: (asCopy = false) => ipcRenderer.invoke('document:save', asCopy),
  update: (id, content) => ipcRenderer.invoke('document:update', id, content),
  imageSource: (id, source) => ipcRenderer.invoke('document:image-source', id, source),
  onDocument: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, document: DocumentSnapshot) => callback(document)
    ipcRenderer.on('document:changed', listener)
    return () => { ipcRenderer.removeListener('document:changed', listener) }
  },
  onBusy: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, busy: boolean) => callback(busy)
    ipcRenderer.on('document:busy', listener)
    return () => { ipcRenderer.removeListener('document:busy', listener) }
  },
  onError: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
    ipcRenderer.on('document:error', listener)
    return () => { ipcRenderer.removeListener('document:error', listener) }
  },
  onFlush: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, requestId: string) => {
      void Promise.resolve().then(callback).catch(() => 'No se pudo sincronizar la edición. No cerrar la ventana.')
        .then((error) => ipcRenderer.invoke('document:flushed', requestId, error))
    }
    ipcRenderer.on('document:flush', listener)
    return () => { ipcRenderer.removeListener('document:flush', listener) }
  }
}

contextBridge.exposeInMainWorld('documents', api)
