import { contextBridge, ipcRenderer } from 'electron'
import type { DocumentBridge, DocumentSnapshot, RecentDocument } from '../shared/documents'
import type { SettingsBridge } from '../shared/settings'
import type { AppearanceBridge } from '../shared/window'
import type { RecentWorkspace, WorkspaceBridge, WorkspaceSnapshot } from '../shared/workspace'
import type { BrainBridge } from '../shared/brain'

const api: DocumentBridge = {
  current: () => ipcRenderer.invoke('document:current'),
  open: () => ipcRenderer.invoke('document:open'),
  recent: () => ipcRenderer.invoke('document:recent'),
  openRecent: (id) => ipcRenderer.invoke('document:open-recent', id),
  onRecentChange: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: RecentDocument[]) => callback(value)
    ipcRenderer.on('document:recent-changed', listener)
    return () => { ipcRenderer.removeListener('document:recent-changed', listener) }
  },
  save: (asCopy = false) => ipcRenderer.invoke('document:save', asCopy),
  printPreview: (settings) => ipcRenderer.invoke('document:print-preview', settings),
  print: (settings, snapshot) => ipcRenderer.invoke('document:print', settings, snapshot),
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

const appearance: AppearanceBridge = {
  setTheme: (theme) => ipcRenderer.invoke('window:theme', theme)
}

contextBridge.exposeInMainWorld('appearance', appearance)

const settings: SettingsBridge = {
  printStyle: () => ipcRenderer.invoke('settings:print-style'),
  setPrintStyle: (css) => ipcRenderer.invoke('settings:set-print-style', css)
}

contextBridge.exposeInMainWorld('settings', settings)

const workspace: WorkspaceBridge = {
  current: () => ipcRenderer.invoke('workspace:current'),
  recent: () => ipcRenderer.invoke('workspace:recent'),
  openRecent: (id) => ipcRenderer.invoke('workspace:open-recent', id),
  onRecentChange: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: RecentWorkspace[]) => callback(value)
    ipcRenderer.on('workspace:recent-changed', listener)
    return () => { ipcRenderer.removeListener('workspace:recent-changed', listener) }
  },
  choose: () => ipcRenderer.invoke('workspace:choose'),
  refresh: () => ipcRenderer.invoke('workspace:refresh'),
  open: (noteId) => ipcRenderer.invoke('workspace:open', noteId),
  preview: (noteId) => ipcRenderer.invoke('workspace:preview', noteId),
  linkTo: (noteId) => ipcRenderer.invoke('workspace:link-to', noteId),
  create: (parentId, name, kind) => ipcRenderer.invoke('workspace:create', parentId, name, kind),
  createIndex: (workspaceId, usage) => ipcRenderer.invoke('workspace:create-index', workspaceId, usage),
  onChange: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: WorkspaceSnapshot | null) => callback(value)
    ipcRenderer.on('workspace:changed', listener)
    return () => { ipcRenderer.removeListener('workspace:changed', listener) }
  }
}

contextBridge.exposeInMainWorld('workspace', workspace)

const brain: BrainBridge = {
  catalog: (request) => ipcRenderer.invoke('brain:catalog', request),
  search: (request) => ipcRenderer.invoke('brain:search', request),
  read: (request) => ipcRenderer.invoke('brain:read', request),
  related: (request) => ipcRenderer.invoke('brain:related', request),
  link: (request) => ipcRenderer.invoke('brain:link', request),
  unlink: (linkId) => ipcRenderer.invoke('brain:unlink', linkId),
  sync: (notebookId) => ipcRenderer.invoke('brain:sync', notebookId),
  status: () => ipcRenderer.invoke('brain:status')
}

contextBridge.exposeInMainWorld('brain', brain)
