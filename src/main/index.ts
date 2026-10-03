import { app, BrowserWindow, Menu } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { titleBarHeight, windowBackground, windowControlsColor } from '../shared/window'
import { attachDocuments } from './documents'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 420,
    minHeight: 300,
    show: false,
    title: 'Sin título — hiloo',
    backgroundColor: windowBackground,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: windowBackground,
      symbolColor: windowControlsColor,
      height: titleBarHeight
    },
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())

  const filePath = join(__dirname, '../renderer/index.html')
  const url = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).href : pathToFileURL(filePath).href
  attachDocuments(window, url)
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(filePath)
  }
}

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
