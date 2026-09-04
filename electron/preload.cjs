const { contextBridge, ipcRenderer } = require('electron')

// Only present inside the Electron desktop build — src/midi.js checks for
// this before using it, so the web build (no preload script) is unaffected.
contextBridge.exposeInMainWorld('electronMidi', {
  ensureLoopMidi: () => ipcRenderer.invoke('midi:ensure-loopmidi'),
})
