const { app, BrowserWindow } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    title: 'Dual Pulse',
    icon: path.join(__dirname, '../build/icon.png'),
    backgroundColor: '#15171c',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Chromium estrangula los timers de una ventana oculta a 1 por segundo si
      // no está sonando, y el scheduler del metrónomo corre cada 25 ms. Medido
      // en esta app: sin esto, oculta y detenida, el scheduler se va a 1000 ms.
      backgroundThrottling: false,
    },
  })

  win.loadFile(path.join(__dirname, '../dist/index.html'))
  win.setMenu(null)
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
