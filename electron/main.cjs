const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFile, spawn } = require('child_process')

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    title: 'Dual Pulse',
    backgroundColor: '#15171c',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  win.loadFile(path.join(__dirname, '../dist/index.html'))
  win.setMenu(null)
}

// ── loopMIDI auto-launch (Windows only) ─────────────────────────────────────
// The app can't create the virtual MIDI port itself (loopMIDI has no
// automation API for that, and the underlying teVirtualMIDI driver SDK
// forbids redistribution without the author's permission) — the user still
// has to open loopMIDI once and create a port by hand. But once that port
// exists, this closes the remaining gap: if loopMIDI isn't running, launch
// it silently so Web MIDI in the renderer finds the port without the user
// having to go open loopMIDI's window themselves every time.
function isLoopMidiRunning(cb) {
  if (process.platform !== 'win32') { cb(false); return; }
  execFile('tasklist', ['/FI', 'IMAGENAME eq loopMIDI.exe', '/NH'], (err, stdout) => {
    cb(!err && /loopmidi\.exe/i.test(stdout || ''))
  })
}

let lastLoopMidiLaunch = 0
function ensureLoopMidiRunning(cb) {
  if (process.platform !== 'win32') { cb({ launched: false, reason: 'unsupported-platform' }); return; }
  const now = Date.now()
  if (now - lastLoopMidiLaunch < 60000) { cb({ launched: false, reason: 'cooldown' }); return; }
  isLoopMidiRunning((running) => {
    if (running) { cb({ launched: false, reason: 'already-running' }); return; }
    const candidates = [
      path.join(process.env['ProgramFiles(x86)'] || '', 'Tobias Erichsen', 'loopMIDI', 'loopMIDI.exe'),
      path.join(process.env.ProgramFiles || '', 'Tobias Erichsen', 'loopMIDI', 'loopMIDI.exe'),
    ]
    const exe = candidates.find((p) => { try { return fs.existsSync(p) } catch { return false } })
    if (!exe) { cb({ launched: false, reason: 'not-installed' }); return; }
    lastLoopMidiLaunch = now
    try {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref()
      cb({ launched: true })
    } catch {
      cb({ launched: false, reason: 'spawn-failed' })
    }
  })
}

ipcMain.handle('midi:ensure-loopmidi', () => new Promise((resolve) => ensureLoopMidiRunning(resolve)))

app.whenReady().then(() => {
  createWindow()
  // fire-and-forget: try to have loopMIDI already up by the time the user
  // opens the MIDI panel, instead of only reacting to that click
  ensureLoopMidiRunning(() => {})
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
