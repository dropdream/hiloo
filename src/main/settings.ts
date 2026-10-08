import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DocumentResult } from '../shared/documents'
import { maxPrintStyleBytes, printStyleProblem } from '../shared/settings'

export function attachSettings(window: BrowserWindow, trustedUrl: string): void {
  const filePath = join(app.getPath('userData'), 'print-style.css')
  const channels = ['settings:print-style', 'settings:set-print-style']

  function validateSender(event: IpcMainInvokeEvent): void {
    if (
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== trustedUrl
    ) {
      throw new Error('Origen de solicitud no permitido.')
    }
  }

  ipcMain.handle('settings:print-style', async (event) => {
    validateSender(event)
    try {
      const file = await fs.open(filePath, 'r')
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > maxPrintStyleBytes) return ''
        const buffer = Buffer.alloc(stat.size)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        const css = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
        return printStyleProblem(css) ? '' : css
      } finally {
        await file.close()
      }
    } catch {
      return ''
    } // Un archivo ausente o dañado usa el estilo predeterminado.
  })

  ipcMain.handle('settings:set-print-style', async (event, css: unknown): Promise<DocumentResult> => {
    validateSender(event)
    const problem = printStyleProblem(css)
    if (problem) return { status: 'error', message: problem }
    const temporary = `${filePath}.${randomUUID()}.tmp`
    try {
      await fs.mkdir(dirname(filePath), { recursive: true })
      await fs.writeFile(temporary, css as string, { flag: 'wx' })
      await fs.rename(temporary, filePath)
      return { status: 'ok' }
    } catch {
      return { status: 'error', message: 'No se pudo guardar el CSS de impresión. Vuelve a intentarlo.' }
    } finally {
      await fs.unlink(temporary).catch(() => {})
    }
  })

  window.once('closed', () => channels.forEach((channel) => ipcMain.removeHandler(channel)))
}
