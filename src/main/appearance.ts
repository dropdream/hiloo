import { ipcMain, type BrowserWindow } from 'electron'
import { titleBarHeight, windowThemes } from '../shared/window'

export function attachAppearance(window: BrowserWindow, trustedUrl: string): void {
  ipcMain.handle('window:theme', (event, theme: unknown) => {
    if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== trustedUrl) {
      throw new Error('Origen de solicitud no permitido.')
    }
    if (theme !== 'day' && theme !== 'night') throw new Error('El tema de la ventana no es válido.')
    const colors = windowThemes[theme]
    window.setBackgroundColor(colors.background)
    window.setTitleBarOverlay({ color: colors.background, symbolColor: colors.controls, height: titleBarHeight })
  })
  window.once('closed', () => ipcMain.removeHandler('window:theme'))
}
