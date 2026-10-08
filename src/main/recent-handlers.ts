import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { DocumentResult } from '../shared/documents'
import type { WorkspaceSession } from './workspace'
import type { DocumentActions } from './documents'
import { RecentPaths } from './recent-paths'

export function createRecentHandlers(
  window: BrowserWindow,
  documents: DocumentActions,
  currentWorkspace: () => WorkspaceSession | null,
  openWorkspace: (path: string, revision: number) => Promise<DocumentResult>
) {
  const recentWorkspaces = new RecentPaths(join(app.getPath('userData'), 'recent-workspaces.json'))
  const recentDocuments = new RecentPaths(join(app.getPath('userData'), 'recent-documents.json'))
  const { operation, confirmChanges, openPath } = documents

  return {
    rememberWorkspace: (path: string) => recentWorkspaces.remember(path),
    // Un fallo del historial no impide abrir ni guardar.
    rememberDocument: (path: string) => recentDocuments.remember(path).catch(() => {}),
    emitDocuments: () => {
      void recentDocuments.list(documents.current().path).then((entries) => {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send('document:recent-changed', entries)
        }
      })
    },
    emitWorkspaces: () => {
      void recentWorkspaces.list(currentWorkspace()?.root ?? null).then((entries) => {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send('workspace:recent-changed', entries)
        }
      })
    },
    listDocuments: () => recentDocuments.list(documents.current().path),
    openDocument: async (id: unknown) => {
      const entry = await recentDocuments.find(id)
      if (!entry) return { status: 'error', message: 'El documento seleccionado no pertenece a los recientes.' }
      return operation(async () => {
        if (!(await confirmChanges())) return { status: 'cancelled' }
        try {
          return await openPath(entry.path, documents.current().revision)
        } catch (error) {
          if (error instanceof Error && error.message === 'El archivo ya no existe.') {
            return {
              status: 'error',
              message: 'El documento ya no está disponible. Comprueba su ubicación o ábrelo con Abrir.'
            }
          }
          throw error
        }
      })
    },
    listWorkspaces: () => recentWorkspaces.list(currentWorkspace()?.root ?? null),
    openWorkspace: async (id: unknown) => {
      const entry = await recentWorkspaces.find(id)
      if (!entry) return { status: 'error', message: 'El cuaderno seleccionado no pertenece a los recientes.' }
      return operation(async () => {
        if (!(await confirmChanges())) return { status: 'cancelled' }
        try {
          return await openWorkspace(entry.path, documents.current().revision)
        } catch (error) {
          if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
            return {
              status: 'error',
              message:
                'El cuaderno ya no está disponible. Comprueba su ubicación o vuelve a abrirlo con Abrir cuaderno.'
            }
          }
          throw error
        }
      })
    }
  }
}
