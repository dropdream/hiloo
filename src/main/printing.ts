import type { BrowserWindow } from 'electron'
import type { DocumentResult } from '../shared/documents'
import { pageMarginMm, type PageSettings } from '../shared/printing'

export function printDocument(window: BrowserWindow, settings: PageSettings): Promise<DocumentResult> {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve({ status: 'cancelled' })
  const contents = window.webContents
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: DocumentResult) => {
      if (settled) return
      settled = true
      contents.removeListener('destroyed', onDestroyed)
      contents.removeListener('render-process-gone', onRendererGone)
      resolve(result)
    }
    const onDestroyed = () => finish({ status: 'cancelled' })
    const onRendererGone = () => finish({ status: 'error', message: 'La vista se cerró antes de completar la impresión.' })
    contents.once('destroyed', onDestroyed)
    contents.once('render-process-gone', onRendererGone)
    // Keep the document operation locked until the native dialog finishes. A timer
    // cannot cancel that dialog and would allow a second print job to overlap it.
    const marginPixels = Math.round(pageMarginMm * 96 / 25.4)
    try {
      contents.print({
        silent: false,
        printBackground: true,
        pageSize: { width: Math.round(settings.widthMm * 1000), height: Math.round(settings.heightMm * 1000) },
        margins: { marginType: 'custom', top: marginPixels, bottom: marginPixels, left: marginPixels, right: marginPixels }
      }, (success, reason) => {
        if (success) finish({ status: 'ok' })
        else if (/cancel(?:led|ed)/i.test(reason)) finish({ status: 'cancelled' })
        else finish({ status: 'error', message: 'No se pudo imprimir el documento. Revisar la impresora y el formato seleccionado.' })
      })
    } catch {
      finish({ status: 'error', message: 'No se pudo iniciar la impresión. Revisar la impresora y el formato seleccionado.' })
    }
  })
}
