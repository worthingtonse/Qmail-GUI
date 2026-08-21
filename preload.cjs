const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  checkUSBDrive: () => ipcRenderer.invoke('check-usb-drive'),
  showErrorDialog: (title, message) => ipcRenderer.invoke('show-error-dialog', title, message),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  // Absolute folder the program runs from — shown in the window title.
  getAppDir: () => ipcRenderer.invoke('get-app-dir'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  getCoinFileState: () => ipcRenderer.invoke('coin-encryption:get-file-state'),
  getAllWalletTransactions: () => ipcRenderer.invoke('wallet:getAllTransactions'),
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
  getAppearanceColors: () => ipcRenderer.invoke('appearance:get-colors'),
  setBackgroundColor: (color) =>
    ipcRenderer.invoke('appearance:set-background-color', color),
  resetBackgroundColor: () =>
    ipcRenderer.invoke('appearance:reset-background-color'),
  setQmailDetailBackgroundColor: (color) =>
    ipcRenderer.invoke('appearance:set-qmail-detail-background-color', color),
  resetQmailDetailBackgroundColor: () =>
    ipcRenderer.invoke('appearance:reset-qmail-detail-background-color'),
  // FIX-02 (Batch 5): open a multi-select file picker for ComposeModal
  // attachments. Resolves to an Array<{path, name, size}>, or [] if
  // the user cancels. ComposeModal checks for window.electronAPI
  // before calling — falls back to a disabled-button state in the
  // browser/Vite build.
  pickAttachments: () => ipcRenderer.invoke('compose:pickFiles'),
  statAttachments: (filePaths) => ipcRenderer.invoke('compose:statFiles', filePaths),
  // Sent-box attachment metadata: fetched + sanitized in the main process so
  // the raw send receipt never enters the renderer (docs/attachment.views.txt).
  getSentAttachmentMetadata: (apiPort, emailId) =>
    ipcRenderer.invoke('qmail:sent-attachment-metadata', apiPort, emailId),
  // Sent-box full to/cc/bcc from the same receipt (sanitized in main).
  getSentRecipients: (apiPort, emailId) =>
    ipcRenderer.invoke('qmail:sent-recipients', apiPort, emailId),
  revealSentAttachment: (apiPort, emailId, attachmentId) =>
    ipcRenderer.invoke(
      'qmail:reveal-sent-attachment',
      apiPort,
      emailId,
      attachmentId,
    ),
  pickWalletCoinFiles: (options = null) => ipcRenderer.invoke('wallet:pickCoinFiles', options),
  pickWalletCoinFolder: (options = null) => ipcRenderer.invoke('wallet:pickCoinFolder', options),
  pickWalletWithdrawFolder: (options = null) =>
    ipcRenderer.invoke('wallet:pickWithdrawFolder', options),
  revealWithdrawnFile: (payload) => ipcRenderer.invoke('wallet:revealWithdrawnFile', payload),
  revealBackupZip: (payload) => ipcRenderer.invoke('wallet:revealBackupZip', payload),
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
  onUpgradeRequested: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('qmail:upgrade-requested', handler);
    return () => ipcRenderer.removeListener('qmail:upgrade-requested', handler);
  },
  // In-place upgrade (upgrade.cjs): whether this build can self-replace,
  // start the download/verify/swap pipeline, cancel the in-flight
  // download, and relaunch into the swapped launcher.
  upgradeSupported: () => ipcRenderer.invoke('qmail:upgrade-supported'),
  startUpgrade: (latestVersion) =>
    ipcRenderer.invoke('qmail:upgrade-start', latestVersion),
  cancelUpgrade: () => ipcRenderer.invoke('qmail:upgrade-cancel'),
  restartAfterUpgrade: () => ipcRenderer.invoke('qmail:upgrade-restart'),
  onUpgradeProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('qmail:upgrade-progress', handler);
    return () => ipcRenderer.removeListener('qmail:upgrade-progress', handler);
  },
  onTitleBarColorPick: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('titlebar:pick-color', handler);
    return () => ipcRenderer.removeListener('titlebar:pick-color', handler);
  },
  onAppearanceColorPick: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('appearance:pick-color', handler);
    return () => ipcRenderer.removeListener('appearance:pick-color', handler);
  },
  onAppearanceColorsChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('appearance:colors-changed', handler);
    return () => ipcRenderer.removeListener('appearance:colors-changed', handler);
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

// Ctrl/Cmd + mouse wheel → page zoom (matches browser behavior and the
// Ctrl+/- shortcuts handled in the main process). Capture + non-passive so
// we can preventDefault before a nested scrollable pane consumes the wheel.
window.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.deltaY === 0) return;
    event.preventDefault();
    // Wheel up / trackpad pinch-out → zoom in; wheel down → zoom out.
    ipcRenderer.send('zoom:adjust', event.deltaY < 0 ? 1 : -1);
  },
  { passive: false, capture: true }
);
