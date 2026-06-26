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
  getDownloadsDir: () => ipcRenderer.invoke('get-downloads-dir'),
  getBackendDataDir: () => ipcRenderer.invoke('get-backend-data-dir'),
  getRaidaCachedStatus: () => ipcRenderer.invoke('get-raida-cached-status'),
  getBootPownPlan: () => ipcRenderer.invoke('qmail:get-boot-pown-plan'),
  setPownOnRestart: (enabled) => ipcRenderer.invoke('qmail:set-pown-on-restart', enabled),
  revealPath: (targetPath) => ipcRenderer.invoke('reveal-path', targetPath),
  getApiToken: () => ipcRenderer.invoke('get-api-token'),
  listSoundFiles: () => ipcRenderer.invoke('list-sound-files'),
  hasIdCoin: () => ipcRenderer.invoke('has-id-coin'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getTitleBarColor: () => ipcRenderer.invoke('titlebar:get-color'),
  setTitleBarColor: (color) => ipcRenderer.invoke('titlebar:set-color', color),
  resetTitleBarColor: () => ipcRenderer.invoke('titlebar:reset-color'),
  // FIX-02 (Batch 5): open a multi-select file picker for ComposeModal
  // attachments. Resolves to an Array<{path, name, size}>, or [] if
  // the user cancels. ComposeModal checks for window.electronAPI
  // before calling — falls back to a disabled-button state in the
  // browser/Vite build.
  pickAttachments: () => ipcRenderer.invoke('compose:pickFiles'),
  statAttachments: (filePaths) => ipcRenderer.invoke('compose:statFiles', filePaths),
  pickWalletCoinFiles: () => ipcRenderer.invoke('wallet:pickCoinFiles'),
  pickWalletCoinFolder: () => ipcRenderer.invoke('wallet:pickCoinFolder'),
  onThemeSelect: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, themeId) => callback(themeId);
    ipcRenderer.on('theme:select', handler);
    return () => ipcRenderer.removeListener('theme:select', handler);
  },
  onQmailMenuCommand: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, command) => callback(command);
    ipcRenderer.on('qmail:menu-command', handler);
    return () => ipcRenderer.removeListener('qmail:menu-command', handler);
  },
  onTitleBarColorPick: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('titlebar:pick-color', handler);
    return () => ipcRenderer.removeListener('titlebar:pick-color', handler);
  },
  onAlertSoundCommand: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('alerts:sound-command', handler);
    return () => ipcRenderer.removeListener('alerts:sound-command', handler);
  },
  onBackendReady: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('backend-ready', handler);
    return () => ipcRenderer.removeListener('backend-ready', handler);
  },
  notifyThemeChanged: (themeId) => ipcRenderer.send('theme:changed', themeId)
});
