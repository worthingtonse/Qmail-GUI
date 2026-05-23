const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');

process.stdout.write('[ELECTRON] Starting...\n');

let mainWindow;
let splashWindow = null;
let backendProcess = null;
let backendPort = 0; // resolved before the backend is spawned
const isDev = process.argv.includes('--dev');

function log(msg) {
  process.stdout.write(`[ELECTRON] ${msg}\n`);
}

// Multi-instance support: ask the OS for a free TCP port. We bind a
// throwaway server to port 0, read the port the OS assigned, then
// close it and hand that port to core.exe via -port. There's a tiny
// race window where another process could grab it between close and
// spawn, but it's the standard pattern and avoids the alternative
// (parsing core.exe's stdout to learn the port, which is fragile).
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// core.exe creates its own Client_Data/ directory next to itself — no setup needed

function startBackend(port) {
  log('Starting backend on port ' + port + '...');

  let backendDir, backendPath, dataDir;

  if (isDev) {
    // Dev: binary lives next to the repo, data lives next to it too.
    // Keeps the dev loop simple.
    backendDir = path.join(__dirname, 'backend');
    backendPath = path.join(backendDir, 'core.exe');
    dataDir = backendDir;
  } else {
    // Packaged: the binary itself ships inside the packaged resources
    // (electron-builder unpacks it to a temp dir on portable launch),
    // but data must persist NEXT TO THE PORTABLE QMail.exe so users
    // can carry their wallets/mail on a USB stick.
    //
    // electron-builder portable mode exposes the launcher's actual
    // on-disk directory via PORTABLE_EXECUTABLE_DIR. When not set
    // (regular packaged install, or running the unpacked binary
    // directly), fall back to the directory of the running .exe.
    backendDir = path.join(process.resourcesPath, 'backend');
    backendPath = path.join(backendDir, 'core.exe');
    dataDir =
      process.env.PORTABLE_EXECUTABLE_DIR
      || path.dirname(app.getPath('exe'));
  }

  log('Backend dir: ' + backendDir);
  log('Backend path: ' + backendPath);
  log('Data dir (cwd): ' + dataDir);

  if (!fs.existsSync(backendPath)) {
    log('ERROR: Backend not found at ' + backendPath);
    return;
  }

  // Make sure the data dir exists. core.exe creates its own
  // Client_Data subdirectory under cwd, but cwd itself must exist —
  // electron-builder's portable mode guarantees this for the
  // launcher location, but PORTABLE_EXECUTABLE_DIR might point at a
  // path the user has since renamed/removed. Be defensive.
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  } catch (e) {
    log('ERROR: Could not create data dir ' + dataDir + ': ' + e.message);
    return;
  }

  try {
    backendProcess = spawn(backendPath, ['-port', String(port)], {
      cwd: dataDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true
    });

    log('Backend started PID: ' + backendProcess.pid + ' on port ' + port);

    backendProcess.stdout.on('data', (data) => {
      log('BACKEND: ' + data.toString().trim());
    });

    backendProcess.stderr.on('data', (data) => {
      log('ERR: ' + data.toString().trim());
    });

    backendProcess.on('exit', (code) => {
      log('Backend exit: ' + code);
      backendProcess = null;
    });

  } catch (error) {
    log('Exception: ' + error.message);
  }
}

// Splash screen shown while the main window loads. Frameless,
// centered, always-on-top. Closes when the main window paints. The
// HTML is hardcoded as a data: URL so we don't need a separate file
// in the asar (and it works the same in dev and packaged builds).
//
// The disclaimer text below mirrors the hardcoded text in
// rest_core/src/commands/cmd_disclaimer.c — kept in sync manually.
// If the C-side text changes, update this string to match.
const SPLASH_DISCLAIMER = [
  "This software is provided 'as-is', without any express or implied",
  "warranty. The value of digital currency can fluctuate. There is no",
  "guarantee of value, and you could lose money. By using this software",
  "you acknowledge these terms and agree to secure your own digital",
  "assets.",
].join(" ");

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 340,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    transparent: false,
    show: true,
    skipTaskbar: false,
    webPreferences: {
      // No preload — splash is static HTML and needs no IPC.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>QMail</title>
<style>
  html, body {
    margin: 0;
    height: 100%;
    background: #0d1117;
    color: #e6edf3;
    font-family: -apple-system, "Segoe UI", Roboto, system-ui, sans-serif;
  }
  .container {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 28px 32px;
    text-align: center;
    box-sizing: border-box;
  }
  .logo {
    font-size: 38px;
    font-weight: 700;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, #60a5fa, #a78bfa);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    margin-bottom: 8px;
  }
  .tagline {
    font-size: 13px;
    color: #8b949e;
    margin-bottom: 22px;
  }
  .status {
    font-size: 13px;
    color: #c9d1d9;
    margin-bottom: 18px;
  }
  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid #30363d;
    border-top-color: #60a5fa;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
    vertical-align: middle;
    margin-right: 8px;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .disclaimer {
    font-size: 11px;
    color: #6e7681;
    line-height: 1.5;
    border-top: 1px solid #21262d;
    padding-top: 14px;
    max-width: 380px;
  }
</style>
</head>
<body>
  <div class="container">
    <div class="logo">QMail</div>
    <div class="tagline">Quantum-resistant secure mail</div>
    <div class="status"><span class="spinner"></span>Starting QMail&hellip;</div>
    <div class="disclaimer">${SPLASH_DISCLAIMER}</div>
  </div>
</body>
</html>`;

  splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Don't flash an empty window — splash is handling that.
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  // mainWindow.webContents.openDevTools();

  // Multi-instance support: the backend port is embedded in the URL
  // query so the renderer can read it synchronously at boot (before
  // any module-level fetch URL is constructed). dev and packaged
  // paths both carry it.
  if (isDev) {
    mainWindow.loadURL(`http://localhost:5173/?backendPort=${port}`);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'), {
      search: `backendPort=${port}`,
    });
  }

  // Once the renderer reports it has painted, close the splash and
  // show the main window. did-finish-load is a slightly-earlier
  // signal than ready-to-show in some Electron versions; use
  // ready-to-show because it waits for the first render.
  mainWindow.once('ready-to-show', () => {
    log('Main window ready');
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
  });
}

// IPC Handlers (tumhare existing handlers)
// USB check is now handled by direct REST API call from the renderer.
// This IPC handler is kept as a fallback stub.
ipcMain.handle('check-usb-drive', async () => {
  return true;
});

ipcMain.handle('show-error-dialog', async (event, title, message) => {
  return dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: title,
    message: message,
    buttons: ['OK']
  });
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// BUG-08 FIX: Expose home directory so renderer can build valid paths
ipcMain.handle('get-home-dir', () => {
  return require('os').homedir();
});

ipcMain.handle('quit-app', () => {
  app.quit();
});

ipcMain.handle('run-command', async (event, command) => {
  // Command execution logic
  return { success: true, output: 'Command executed' };
});

ipcMain.handle('read-file', async (event, filename) => {
  try {
    // BUG-01 FIX: Validate path to prevent path traversal attacks
    const base = isDev ? path.join(__dirname, 'public') : process.resourcesPath;
    const resolved = path.resolve(base, filename);
    if (!resolved.startsWith(base)) {
      return { success: false, error: 'Access denied: path traversal detected' };
    }
    const content = fs.readFileSync(resolved, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// FIX-02 (Batch 5): file picker for ComposeModal attachments. Returns
// enriched file metadata objects so the renderer can show staged-file
// chips with name + size without doing its own fs.stat (which it
// can't, since contextIsolation is on).
//
// Contract:
//   resolves to an Array of { path, name, size } on success
//   resolves to [] when the user cancels
//   per-file stat failures (e.g. file deleted between picker and
//   stat) drop that file from the result and log; the picker as a
//   whole still resolves so the renderer can use whatever survived.
ipcMain.handle('compose:pickFiles', async () => {
  let result;
  try {
    result = await dialog.showOpenDialog(mainWindow, {
      title: 'Attach files',
      properties: ['openFile', 'multiSelections'],
    });
  } catch (error) {
    log('compose:pickFiles dialog error: ' + error.message);
    return [];
  }

  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return [];
  }

  const enriched = await Promise.all(
    result.filePaths.map(async (filePath) => {
      try {
        const stat = await fs.promises.stat(filePath);
        return {
          path: filePath,
          name: path.basename(filePath),
          size: stat.size,
        };
      } catch (error) {
        log('compose:pickFiles stat failed for ' + filePath + ': ' + error.message);
        return null;
      }
    }),
  );

  return enriched.filter((entry) => entry !== null);
});

// Boot sequence:
//   1. Pick a free port for the backend (OS-assigned, supports multi-instance).
//   2. Open the splash window immediately so the user sees life.
//   3. Spawn core.exe with that port.
//   4. Load the main renderer with the port in the URL.
//   5. Splash closes when the main window's first paint fires.
async function boot() {
  try {
    backendPort = await findFreePort();
    log('Reserved port: ' + backendPort);
  } catch (e) {
    log('ERROR: Could not reserve a free port: ' + e.message);
    backendPort = 8080; // fallback to historical default
  }

  createSplashWindow();
  startBackend(backendPort);
  createMainWindow(backendPort);
}

app.whenReady().then(boot);

// BUG-24 FIX: Kill backend on all exit paths, not just window-all-closed
const killBackend = () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
};

app.on('before-quit', killBackend);
app.on('window-all-closed', () => {
  killBackend();
  app.quit();
});
process.on('SIGTERM', killBackend);
process.on('SIGINT', killBackend);