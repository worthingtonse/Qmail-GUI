const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  checkUSBDrive: () => ipcRenderer.invoke('check-usb-drive'),
  showErrorDialog: (title, message) => ipcRenderer.invoke('show-error-dialog', title, message),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  // Add CLI command support
  runCommand: (command) => ipcRenderer.invoke('run-command', command),
  // Add file reading support for EFF wordlist
  readFile: (filename) => ipcRenderer.invoke('read-file', filename),
  // BUG-08 FIX: Get home directory for path expansion
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
  // FIX-02 (Batch 5): open a multi-select file picker for ComposeModal
  // attachments. Resolves to an Array<{path, name, size}>, or [] if
  // the user cancels. ComposeModal checks for window.electronAPI
  // before calling — falls back to a disabled-button state in the
  // browser/Vite build.
  pickAttachments: () => ipcRenderer.invoke('compose:pickFiles')
});