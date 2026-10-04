import type { BrowserWindow } from 'electron'
import type { DocumentResult } from '../shared/documents'
import { pageMarginMm, type PageSettings } from '../shared/printing'

const maxPreviewBytes = 20 * 1024 * 1024

export async function previewDocument(window: BrowserWindow, settings: PageSettings): Promise<{ status: 'ok'; pdf: Uint8Array } | Exclude<DocumentResult, { status: 'ok' }>> {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return { status: 'cancelled' }
  try {
    // Match the app's @page rule without invoking a printer or writing a file.
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: { width: settings.widthMm / 25.4, height: settings.heightMm / 25.4 },
      margins: { top: pageMarginMm / 25.4, bottom: pageMarginMm / 25.4, left: pageMarginMm / 25.4, right: pageMarginMm / 25.4 }
    })
    if (window.isDestroyed() || window.webContents.isDestroyed()) return { status: 'cancelled' }
    if (!pdf.length || pdf.length > maxPreviewBytes) return { status: 'error', message: 'La vista previa supera el límite de 20 MB o no contiene páginas. Reduce el contenido antes de imprimir.' }
    // Buffer is a main-process type; send only copied PDF bytes over the bridge.
    return { status: 'ok', pdf: new Uint8Array(pdf) }
  } catch {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return { status: 'cancelled' }
    return { status: 'error', message: 'No se pudo generar la vista previa de impresión. Espera y vuelve a intentarlo.' }
  }
}

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
