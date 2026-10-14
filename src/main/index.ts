import { app, shell, BrowserWindow, session, dialog } from 'electron'
import { join, resolve } from 'node:path'
import { initDatabase, persistNow } from './db'
import { migratePrivateSettings } from './store'
import { registerIpc } from './ipc'

if (process.env.NHQ_AUTODIALER_DATA_DIR) app.setPath('userData', resolve(process.env.NHQ_AUTODIALER_DATA_DIR))
let mainWindow: BrowserWindow | null = null
const testMode = process.env.NHQ_AUTODIALER_TEST_MODE === '1'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200, height: 820, minWidth: 760, minHeight: 600,
    show: false, autoHideMenuBar: true, title: 'NHQ AutoDialer', backgroundColor: '#0f1f3d',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  mainWindow = window
  window.on('ready-to-show', () => { if (!testMode) window.show() })
  window.on('closed', () => { mainWindow = null })
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (['https:', 'http:'].includes(new URL(url).protocol)) void shell.openExternal(url)
    } catch { /* Invalid lead websites stay inside the app. */ }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
  const loading = process.env.ELECTRON_RENDERER_URL
    ? window.loadURL(process.env.ELECTRON_RENDERER_URL)
    : window.loadFile(join(__dirname, '../renderer/index.html'))
  void loading.catch(() => {
    dialog.showErrorBox('NHQ AutoDialer', 'The interface could not load. Rebuild the app or reinstall it. Your local data has been kept.')
    app.quit()
  })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { mainWindow?.restore(); mainWindow?.focus() })
  void app.whenReady().then(async () => {
    const trusted = (window: Electron.WebContents | null): boolean => Boolean(window && window === mainWindow?.webContents)
    session.defaultSession.setPermissionRequestHandler((window, permission, callback, details) => {
      callback(trusted(window) && permission === 'media' && !('mediaTypes' in details && details.mediaTypes?.includes('video')))
    })
    session.defaultSession.setPermissionCheckHandler((window, permission, _origin, details) => trusted(window) && permission === 'media' && details.mediaType !== 'video')
    await initDatabase()
    migratePrivateSettings()
    registerIpc(() => mainWindow)
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  }).catch(() => {
    dialog.showErrorBox('NHQ AutoDialer', 'Local data could not be opened. Close other copies of the app and check that its data folder is writable. Your files have been kept.')
    app.quit()
  })
}

app.on('before-quit', () => persistNow())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
