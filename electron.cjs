const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');

process.stdout.write('[ELECTRON] Starting...\n');

let mainWindow;
let splashWindow = null;
let backendProcess = null;
let backendPort = 0; // resolved before the backend is spawned
let activeThemeMenuItem = 'dark';
let backendDataDir = null;
let titleBarColor = '#C9CC3F';
const selectedAttachmentPaths = new Set();

// R-2 hardening: per-session random token. core.exe requires it as a bearer
// credential on the object-transfer endpoints (the ones that accept arbitrary
// filesystem paths), so other local processes cannot drive them. Passed to
// the backend via env (QMAIL_API_TOKEN) so it never appears on the visible
// command line, and handed to the renderer over IPC.
const apiSessionToken = crypto.randomBytes(32).toString('hex');

const THEME_MENU_ITEMS = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'high-contrast', label: 'High Contrast' },
];

const SOUND_FILE_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']);
const DEFAULT_TITLE_BAR_COLOR = '#C9CC3F';
const WINDOW_SETTINGS_FILE = 'qmail-window-settings.json';

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

const DEFAULT_QMAIL_RAIDAS = new Set([0, 1, 11, 13, 14, 18, 20, 22, 24]);

function readTextFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function parseRaidaIpsCsv(content) {
  const rows = new Map();
  if (!content) return rows;

  let index = 0;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const comma = line.lastIndexOf(',');
    const endpoint = comma >= 0 ? line.slice(0, comma).trim() : line;
    const flag = comma >= 0 ? line.slice(comma + 1).trim().toUpperCase() : '';
    const colon = endpoint.lastIndexOf(':');
    if (colon <= 0) {
      index += 1;
      continue;
    }

    const ip = endpoint.slice(0, colon).trim();
    const port = Number(endpoint.slice(colon + 1).trim());
    if (!ip || !Number.isInteger(port)) {
      index += 1;
      continue;
    }

    rows.set(index, {
      index,
      ip,
      port,
      is_qmail: flag === 'Q' || (!flag && DEFAULT_QMAIL_RAIDAS.has(index)),
      qmail_flag: flag === 'Q' || flag === 'R' ? flag : null,
    });
    index += 1;
  }
  return rows;
}

function parseRaidaStatsCsv(content) {
  const rows = new Map();
  if (!content) return rows;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(',').map((part) => part.trim());
    if (parts.length < 3) continue;

    const index = Number(parts[0]);
    const lastResponseMs = Number(parts[1]);
    const isAvailable = Number(parts[2]);
    if (!Number.isInteger(index) || index < 0 || index >= 25) continue;

    rows.set(index, {
      index,
      last_response_ms: Number.isFinite(lastResponseMs) ? lastResponseMs : null,
      is_available: isAvailable === 1 ? true : isAvailable === 0 ? false : null,
    });
  }
  return rows;
}

function buildCachedRaidaStatus() {
  if (!backendDataDir) {
    return { success: false, error: 'Backend data directory is not set yet' };
  }

  const clientDataDir = path.join(backendDataDir, 'Client_Data');
  const ipsPath = path.join(clientDataDir, 'raida_ips.csv');
  const statsPath = path.join(clientDataDir, 'raida_stats.csv');
  const topology = parseRaidaIpsCsv(readTextFileIfExists(ipsPath));
  const stats = parseRaidaStatsCsv(readTextFileIfExists(statsPath));

  if (topology.size === 0 && stats.size === 0) {
    return {
      success: false,
      error: 'No cached RAIDA topology or stats files found',
      clientDataDir,
      files: {
        raida_ips: fs.existsSync(ipsPath),
        raida_stats: fs.existsSync(statsPath),
      },
    };
  }

  const raidas = Array.from({ length: 25 }, (_, index) => {
    const topo = topology.get(index) || null;
    const stat = stats.get(index) || null;
    return {
      index,
      ip: topo ? topo.ip : '',
      port: topo ? topo.port : 50000 + index,
      is_qmail: topo ? topo.is_qmail : DEFAULT_QMAIL_RAIDAS.has(index),
      qmail_flag: topo ? topo.qmail_flag : null,
      is_available: stat ? stat.is_available : null,
      last_response_ms: stat ? stat.last_response_ms : null,
    };
  });

  const qmailServers = raidas
    .filter((raida) => raida.is_qmail)
    .map((raida) => ({
      raida_index: raida.index,
      server_id: raida.index,
      ip: raida.ip,
      ip_address: raida.ip,
      port: raida.port,
      is_available: raida.is_available,
      latency_ms: raida.last_response_ms,
    }));

  return {
    success: true,
    source: 'csv',
    clientDataDir,
    files: {
      raida_ips: fs.existsSync(ipsPath),
      raida_stats: fs.existsSync(statsPath),
    },
    raidas,
    qmailServers,
    totalAvailable: raidas.filter((raida) => raida.is_available === true).length,
    totalError: raidas.filter((raida) => raida.is_available === false).length,
    qmailAvailable: qmailServers.filter((server) => server.is_available === true).length,
  };
}
function resolveSoundLibraryDir() {
  const candidates = isDev
    ? [
        path.join(app.getAppPath(), 'public', 'sounds'),
        path.join(app.getAppPath(), 'dist', 'sounds'),
      ]
    : [
        path.join(app.getAppPath(), 'dist', 'sounds'),
        path.join(app.getAppPath(), 'public', 'sounds'),
      ];

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        return dir;
      }
    } catch {
      /* ignore */
    }
  }

  return candidates[0];
}

function isStandardTheme(themeId) {
  return THEME_MENU_ITEMS.some((item) => item.id === themeId);
}

function log(msg) {
  process.stdout.write(`[ELECTRON] ${msg}\n`);
}

function runPowerShell(script, extraEnv = {}) {
  return spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script
  ], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    windowsHide: true
  });
}

function terminateProcessTree(pid, reason) {
  if (!pid) return;

  try {
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        encoding: 'utf8',
        windowsHide: true
      });
      const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
      if (result.error) {
        log(`Backend ${reason}: taskkill failed for PID ${pid}: ${result.error.message}`);
      } else if (result.status === 0) {
        log(`Backend ${reason}: terminated PID ${pid}` + (output ? ` (${output})` : ''));
      } else {
        log(`Backend ${reason}: taskkill exited ${result.status} for PID ${pid}` + (output ? ` (${output})` : ''));
      }
      return;
    }

    process.kill(pid, 'SIGTERM');
    log(`Backend ${reason}: sent SIGTERM to PID ${pid}`);
  } catch (error) {
    log(`Backend ${reason}: terminate PID ${pid} failed: ${error.message}`);
  }
}

function cleanupOrphanedBackendsForDataDir(dataDir) {
  if (process.platform !== 'win32' || !dataDir) return;

  const script = [
    "$target = [Environment]::GetEnvironmentVariable('QMAIL_TARGET_DATA_DIR')",
    "if ([string]::IsNullOrWhiteSpace($target)) { exit 0 }",
    "$target = [IO.Path]::GetFullPath($target).TrimEnd('\\')",
    "$targetLower = $target.ToLowerInvariant()",
    "$pattern = '(?i)(^|\\s)-data-dir\\s+\"?' + [Regex]::Escape($targetLower) + '\\\\?\"?(?=\\s|$)'",
    "$processes = Get-CimInstance Win32_Process -Filter \"Name = 'core.exe'\"",
    "foreach ($proc in $processes) {",
    "  $cmd = $proc.CommandLine",
    "  if ([string]::IsNullOrWhiteSpace($cmd)) { continue }",
    "  $normalized = ($cmd -replace '/', '\\').ToLowerInvariant()",
    "  if ($normalized -notmatch $pattern) { continue }",
    "  $parent = Get-CimInstance Win32_Process -Filter (\"ProcessId = {0}\" -f $proc.ParentProcessId) -ErrorAction SilentlyContinue",
    "  if ($parent -and ($parent.Name -eq 'QMail.exe' -or $parent.Name -eq 'electron.exe')) { continue }",
    "  try {",
    "    Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop",
    "    Write-Output (\"Killed orphaned core.exe PID={0} dataDir={1}\" -f $proc.ProcessId, $target)",
    "  } catch {",
    "    Write-Output (\"Failed to kill orphaned core.exe PID={0}: {1}\" -f $proc.ProcessId, $_.Exception.Message)",
    "  }",
    "}"
  ].join('\n');

  const result = runPowerShell(script, { QMAIL_TARGET_DATA_DIR: dataDir });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.error) {
    log('Orphan backend cleanup failed: ' + result.error.message);
  } else if (output) {
    log('Orphan backend cleanup: ' + output);
  }
}

function normalizeHexColor(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) return null;
  return trimmed.toUpperCase();
}

function colorRefFromHex(color) {
  const normalized = normalizeHexColor(color) || DEFAULT_TITLE_BAR_COLOR;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return (b << 16) | (g << 8) | r;
}

function titleBarTextColorFor(backgroundColor) {
  const normalized = normalizeHexColor(backgroundColor) || DEFAULT_TITLE_BAR_COLOR;
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const linear = [r, g, b].map((channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4)
  );
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.45 ? '#000000' : '#FFFFFF';
}

function getWindowSettingsPath() {
  const rootDir = backendDataDir || app.getPath('userData');
  return path.join(rootDir, WINDOW_SETTINGS_FILE);
}

function readWindowSettings() {
  try {
    const settingsPath = getWindowSettingsPath();
    if (!fs.existsSync(settingsPath)) return {};
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    log('Window settings read failed: ' + error.message);
    return {};
  }
}

function loadWindowSettings() {
  const settings = readWindowSettings();
  titleBarColor = normalizeHexColor(settings.titleBarColor) || DEFAULT_TITLE_BAR_COLOR;
}

function saveWindowSettings(nextSettings) {
  try {
    const settingsPath = getWindowSettingsPath();
    const current = readWindowSettings();
    const merged = { ...current, ...nextSettings };
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    return true;
  } catch (error) {
    log('Window settings save failed: ' + error.message);
    return false;
  }
}

function getNativeWindowHandleDecimal(windowRef) {
  if (!windowRef || windowRef.isDestroyed()) return null;
  const handle = windowRef.getNativeWindowHandle();
  if (!Buffer.isBuffer(handle) || handle.length < 4) return null;
  if (handle.length >= 8) {
    return handle.readBigUInt64LE(0).toString();
  }
  return BigInt(handle.readUInt32LE(0)).toString();
}

function applyNativeTitleBarColor(windowRef, color) {
  const normalized = normalizeHexColor(color) || DEFAULT_TITLE_BAR_COLOR;
  if (!windowRef || windowRef.isDestroyed()) return;

  if (typeof windowRef.setBackgroundColor === 'function') {
    windowRef.setBackgroundColor(normalized);
  }

  if (process.platform !== 'win32') return;

  const hwnd = getNativeWindowHandleDecimal(windowRef);
  if (!hwnd) return;

  const script = [
    "$source = @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class QmailDwmApi {",
    "  [DllImport(\"dwmapi.dll\")]",
    "  public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);",
    "}",
    "'@",
    "Add-Type -TypeDefinition $source -ErrorAction Stop",
    "$hwndValue = [UInt64]::Parse([Environment]::GetEnvironmentVariable('QMAIL_WINDOW_HWND'))",
    "$hwnd = [IntPtr]([Int64]$hwndValue)",
    "$caption = [Int32]::Parse([Environment]::GetEnvironmentVariable('QMAIL_TITLE_BAR_COLORREF'))",
    "$text = [Int32]::Parse([Environment]::GetEnvironmentVariable('QMAIL_TITLE_BAR_TEXT_COLORREF'))",
    "$border = $caption",
    "$captionResult = [QmailDwmApi]::DwmSetWindowAttribute($hwnd, 35, [ref]$caption, 4)",
    "$textResult = [QmailDwmApi]::DwmSetWindowAttribute($hwnd, 36, [ref]$text, 4)",
    "$borderResult = [QmailDwmApi]::DwmSetWindowAttribute($hwnd, 34, [ref]$border, 4)",
    "if ($captionResult -ne 0 -or $textResult -ne 0 -or $borderResult -ne 0) {",
    "  Write-Output (\"DwmSetWindowAttribute results caption={0} text={1} border={2}\" -f $captionResult, $textResult, $borderResult)",
    "}",
  ].join('\n');

  const result = runPowerShell(script, {
    QMAIL_WINDOW_HWND: hwnd,
    QMAIL_TITLE_BAR_COLORREF: String(colorRefFromHex(normalized)),
    QMAIL_TITLE_BAR_TEXT_COLORREF: String(colorRefFromHex(titleBarTextColorFor(normalized))),
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.error) {
    log('Title bar color failed: ' + result.error.message);
  } else if (output) {
    log('Title bar color: ' + output);
  }
}

function setTitleBarColor(color, { persist = true } = {}) {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return { success: false, error: 'Color must be in #RRGGBB format' };
  }

  titleBarColor = normalized;
  applyNativeTitleBarColor(mainWindow, titleBarColor);
  if (persist) {
    saveWindowSettings({ titleBarColor });
  }
  buildApplicationMenu();
  return { success: true, color: titleBarColor, defaultColor: DEFAULT_TITLE_BAR_COLOR };
}

function resetTitleBarColor() {
  return setTitleBarColor(DEFAULT_TITLE_BAR_COLOR);
}

// BUG-51: CLI surface for QMail.exe. Parses our own flags; everything
// not recognized triggers usage + exit. Long-options are GNU style.
// All flags map 1:1 to core.exe flags of the same name (defined in
// rest_core/api_src/main_rest.c) — keep the names aligned.
const QMAIL_USAGE =
`Usage: QMail.exe [options]

Options:
  --port <N>      Pin backend (core) HTTP port to N (1..65535).
                  Default: random free port.
  --debug         Enable core.exe debug logging (forwarded as -debug).
                  DevTools are reachable from the renderer via F12.
  --dev           Run against the Vite dev server at localhost:5173
                  instead of the bundled renderer.
  --version, -V   Print version and exit.
  --help, -h      Print this message and exit.

Examples:
  QMail.exe                          Normal launch, random backend port.
  QMail.exe --port 8081              Pin backend to port 8081.
  QMail.exe --port 8082 --debug      Pin port 8082, verbose core logging.

Two instances launched without --port each get their own random port,
so they will not conflict.`;

function parseQMailArgs(argv) {
  const out = { port: null, debug: false, dev: false };
  // argv[0] is the electron binary, argv[1] is the script path in dev.
  // In a packaged build there's no script path arg, but slice(2) is the
  // standard Electron convention for "args after our own".
  // electron-builder portable also injects PORTABLE_EXECUTABLE_DIR but
  // no extra positional args we need to skip.
  const args = argv.slice(process.defaultApp ? 2 : 1);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      process.stdout.write(QMAIL_USAGE + '\n');
      app.exit(0);
      return null;
    }
    if (a === '--version' || a === '-V') {
      process.stdout.write(`QMail ${app.getVersion()}\n`);
      app.exit(0);
      return null;
    }
    if (a === '--dev')   { out.dev   = true; continue; }
    if (a === '--debug') { out.debug = true; continue; }
    if (a === '--port' || a.startsWith('--port=')) {
      const v = a.startsWith('--port=') ? a.slice(7) : args[++i];
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        process.stderr.write(`QMail: invalid port '${v}' (expected 1..65535)\n`);
        process.stderr.write(QMAIL_USAGE + '\n');
        app.exit(2);
        return null;
      }
      out.port = n;
      continue;
    }
    process.stderr.write(`QMail: unrecognized option '${a}'\n`);
    process.stderr.write(QMAIL_USAGE + '\n');
    app.exit(2);
    return null;
  }
  return out;
}

const qmailArgs = parseQMailArgs(process.argv) || { port: null, debug: false, dev: false };
const isDev = qmailArgs.dev;
log(`Args: port=${qmailArgs.port ?? 'random'} debug=${qmailArgs.debug} dev=${qmailArgs.dev}`);

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

  backendDataDir = dataDir;

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

  // BUG-52: core.exe uses GetModuleFileNameA() to locate Client_Data,
  // which in portable mode points at Electron's temp extraction dir.
  // Pass -data-dir explicitly so user data lands next to QMail.exe.
  const coreArgs = ['-port', String(port), '-data-dir', dataDir];
  if (qmailArgs.debug) coreArgs.push('-debug');
  log('Backend args: ' + coreArgs.join(' '));

  try {
    cleanupOrphanedBackendsForDataDir(dataDir);

    const child = spawn(backendPath, coreArgs, {
      cwd: dataDir,
      env: { ...process.env, QMAIL_API_TOKEN: apiSessionToken },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true
    });
    backendProcess = child;

    log('Backend started PID: ' + child.pid + ' on port ' + port);

    child.stdout.on('data', (data) => {
      const output = data.toString().trim();
      log('BACKEND: ' + output);

      // Detect when backend is ready to accept requests
      if (output.includes('REST API server running on')) {
        log('Backend is ready for requests');
        // Broadcast to all windows that backend is ready
        if (mainWindow) {
          mainWindow.webContents.send('backend-ready', { port });
        }
      }
    });

    child.stderr.on('data', (data) => {
      log('ERR: ' + data.toString().trim());
    });

    child.on('error', (error) => {
      log('Backend process error: ' + error.message);
      if (backendProcess === child) {
        backendProcess = null;
      }
    });

    child.on('exit', (code, signal) => {
      log(`Backend exit: code=${code} signal=${signal || 'none'}`);
      if (backendProcess === child) {
        backendProcess = null;
      }
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
    <div class="tagline">Quantum-safe secure mail</div>
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

function sendThemeToRenderer(themeId) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('theme:select', themeId);
}
function sendQmailMenuCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('qmail:menu-command', command);
}

function sendTitleBarColorPickerCommand() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('titlebar:pick-color', {
    color: titleBarColor,
    defaultColor: DEFAULT_TITLE_BAR_COLOR,
  });
}

function setThemeFromMenu(themeId) {
  if (!isStandardTheme(themeId)) return;
  activeThemeMenuItem = themeId;
  buildApplicationMenu();
  sendThemeToRenderer(themeId);
}

function buildApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Empty Trash',
          click: () => sendQmailMenuCommand('empty-trash'),
        },
        {
          label: 'Empty Drafts',
          click: () => sendQmailMenuCommand('empty-drafts'),
        },
        {
          label: 'Empty Inbox',
          click: () => sendQmailMenuCommand('empty-inbox'),
        },
        {
          label: 'Mark all as read',
          click: () => sendQmailMenuCommand('mark-all-read'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Appearance',
          submenu: THEME_MENU_ITEMS.map(({ id, label }) => ({
            label,
            type: 'radio',
            checked: activeThemeMenuItem === id,
            click: () => setThemeFromMenu(id),
          })),
        },
        { type: 'separator' },
        {
          label: 'Title Bar Color...',
          click: () => sendTitleBarColorPickerCommand(),
        },
        {
          label: 'Reset Title Bar Color',
          enabled: titleBarColor !== DEFAULT_TITLE_BAR_COLOR,
          click: () => resetTitleBarColor(),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: `About ${app.name}`,
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: `About ${app.name}`,
            message: `${app.name} ${app.getVersion()}`,
            buttons: ['OK'],
          }),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Don't flash an empty window — splash is handling that.
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      // Enable Chromium spellcheck and pin the dictionary to en-US so the
      // English build always uses the same dictionary regardless of OS
      // locale. Suggestions arrive via the context-menu handler below.
      spellcheck: true,
    },
  });
  applyNativeTitleBarColor(mainWindow, titleBarColor);
  // setSpellCheckerLanguages must be called on the session AFTER the
  // window exists; safe to do here.
  mainWindow.webContents.session.setSpellCheckerLanguages(['en-US']);

  // Chromium computes misspelling suggestions but Electron does not render
  // a default context menu — apps must build one. This handler shows up to
  // five suggestions, an Add-to-Dictionary entry, and standard editor
  // actions. Without it the user sees red squiggles with no way to fix them.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const items = [];

    if (params.misspelledWord) {
      const suggestions = (params.dictionarySuggestions || []).slice(0, 5);
      for (const suggestion of suggestions) {
        items.push({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion),
        });
      }
      if (suggestions.length === 0) {
        items.push({ label: 'No suggestions', enabled: false });
      }
      items.push({
        label: 'Add to Dictionary',
        click: () =>
          mainWindow.webContents.session.addWordToSpellCheckerDictionary(
            params.misspelledWord
          ),
      });
      items.push({ type: 'separator' });
    }

    if (params.isEditable) {
      items.push({ role: 'cut', enabled: params.editFlags.canCut });
      items.push({ role: 'copy', enabled: params.editFlags.canCopy });
      items.push({ role: 'paste', enabled: params.editFlags.canPaste });
      items.push({ type: 'separator' });
      items.push({ role: 'selectAll' });
    } else if (params.selectionText) {
      items.push({ role: 'copy' });
    }

    if (items.length > 0) {
      Menu.buildFromTemplate(items).popup({ window: mainWindow });
    }
  });

  buildApplicationMenu();

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
    applyNativeTitleBarColor(mainWindow, titleBarColor);
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

ipcMain.handle('titlebar:get-color', () => ({
  success: true,
  color: titleBarColor,
  defaultColor: DEFAULT_TITLE_BAR_COLOR,
}));

ipcMain.handle('titlebar:set-color', (_event, color) => {
  return setTitleBarColor(color);
});

ipcMain.handle('titlebar:reset-color', () => {
  return resetTitleBarColor();
});

ipcMain.on('theme:changed', (_event, themeId) => {
  if (!isStandardTheme(themeId) || activeThemeMenuItem === themeId) return;
  activeThemeMenuItem = themeId;
  buildApplicationMenu();
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
        const resolvedPath = path.resolve(filePath);
        selectedAttachmentPaths.add(resolvedPath);
        return {
          path: resolvedPath,
          name: path.basename(resolvedPath),
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

ipcMain.handle('compose:statFiles', async (_event, filePaths) => {
  if (!Array.isArray(filePaths)) return [];

  return Promise.all(
    filePaths.map(async (filePath) => {
      const resolvedPath = path.resolve(String(filePath || ''));
      if (!selectedAttachmentPaths.has(resolvedPath)) {
        return {
          path: resolvedPath,
          success: false,
          error: 'File was not selected through the attachment picker.',
        };
      }
      try {
        const stat = await fs.promises.stat(resolvedPath);
        if (!stat.isFile()) {
          return {
            path: resolvedPath,
            success: false,
            error: 'Attachment is no longer a regular file.',
          };
        }
        return {
          path: resolvedPath,
          name: path.basename(resolvedPath),
          size: stat.size,
          success: true,
        };
      } catch (error) {
        return {
          path: resolvedPath,
          success: false,
          error: error.message,
        };
      }
    }),
  );
});

ipcMain.handle('wallet:pickCoinFiles', async () => {
  let result;
  try {
    result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose CloudCoin files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'CloudCoin files', extensions: ['bin', 'stack', 'zip', 'png'] }],
    });
  } catch (error) {
    log('wallet:pickCoinFiles dialog error: ' + error.message);
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
        log('wallet:pickCoinFiles stat failed for ' + filePath + ': ' + error.message);
        return null;
      }
    }),
  );

  return enriched.filter((entry) => entry !== null);
});

ipcMain.handle('wallet:pickCoinFolder', async () => {
  let result;
  try {
    result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose CloudCoin folder',
      properties: ['openDirectory'],
    });
  } catch (error) {
    log('wallet:pickCoinFolder dialog error: ' + error.message);
    return null;
  }

  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];
  return {
    path: folderPath,
    name: path.basename(folderPath) || folderPath,
  };
});

ipcMain.handle('get-downloads-dir', async () => app.getPath('downloads'));

ipcMain.handle('get-backend-data-dir', async () => backendDataDir || null);

ipcMain.handle('get-raida-cached-status', async () => {
  try {
    return buildCachedRaidaStatus();
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('get-api-token', async () => apiSessionToken);

// Filenames that are NOT coins — OS/editor cruft that can litter a wallet
// directory. A directory containing only these must NOT count as "has ID".
const NON_COIN_FILES = new Set([
  '.ds_store',
  'thumbs.db',
  'desktop.ini',
  '.gitkeep',
]);

// Returns true if `dir` (or any subdirectory) contains at least one real
// coin file. Coins may live directly in Bank/Fracked or be nested one level
// deeper, so we recurse. We can't reliably allow-list coin extensions here
// (the layout isn't documented in this process), so instead we treat any
// regular file that isn't known OS/editor junk as a coin.
function dirHasCoinFile(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    log(`has-id-coin: error reading ${dir}: ${error.message}`);
    return false;
  }

  for (const entry of entries) {
    if (entry.isFile()) {
      if (!NON_COIN_FILES.has(entry.name.toLowerCase())) {
        return true;
      }
    } else if (entry.isDirectory()) {
      if (dirHasCoinFile(path.join(dir, entry.name))) {
        return true;
      }
    }
  }
  return false;
}

ipcMain.handle('has-id-coin', async () => {
  if (!backendDataDir) {
    return { has_id: false, error: 'Data directory not available' };
  }

  const idCoinDirs = [
    path.join(backendDataDir, 'Client_Data', 'Wallets', 'Mail', 'Bank'),
    path.join(backendDataDir, 'Client_Data', 'Wallets', 'Mail', 'Fracked'),
  ];

  for (const dir of idCoinDirs) {
    if (fs.existsSync(dir) && dirHasCoinFile(dir)) {
      return { has_id: true };
    }
  }

  return { has_id: false };
});

// Open an external URL in the user's default browser. Restricted to
// http/https so the renderer can't use this to launch arbitrary local
// programs (file:, etc.).
ipcMain.handle('open-external', async (_event, url) => {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { success: false, error: 'Only http/https URLs may be opened.' };
    }
    await shell.openExternal(parsed.href);
    return { success: true };
  } catch (error) {
    log(`open-external failed for ${url}: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reveal-path', async (_event, targetPath) => {
  try {
    const requestedPath = String(targetPath || '').trim();
    if (!requestedPath) return { success: false, error: 'Path is empty.' };

    const resolvedPath = await fs.promises.realpath(path.resolve(requestedPath));
    const allowedRoots = [app.getPath('downloads'), backendDataDir]
      .filter(Boolean)
      .map((rootPath) => path.resolve(rootPath));
    if (!allowedRoots.some((rootPath) => isPathInside(rootPath, resolvedPath))) {
      return { success: false, error: 'Opening this path is not permitted.' };
    }

    const stat = await fs.promises.stat(resolvedPath);
    if (stat.isDirectory()) {
      const result = await shell.openPath(resolvedPath);
      if (result) return { success: false, error: result };
    } else {
      shell.showItemInFolder(resolvedPath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-sound-files', async () => {
  const dir = resolveSoundLibraryDir();
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => SOUND_FILE_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .map((filename) => ({
        filename,
        label: filename.replace(/\.[^.]+$/, '').trim() || filename,
        src: `./sounds/${encodeURIComponent(filename)}`,
      }));
  } catch (error) {
    log('list-sound-files failed for ' + dir + ': ' + error.message);
    return [];
  }
});
// Boot sequence (Option 2 - backend gets a head start):
//   1. Pick a free port for the backend (OS-assigned, supports multi-instance).
//   2. Spawn core.exe with that port (backend starts in background).
//   3. Open the splash window so the user sees life.
//   4. Load the main renderer with the port in the URL.
//   5. Splash closes when the main window's first paint fires.
//   6. Frontend receives backend-ready signal when core.exe is listening.
async function boot() {
  if (qmailArgs.port !== null) {
    backendPort = qmailArgs.port;
    log('Using explicit port: ' + backendPort);
  } else {
    try {
      backendPort = await findFreePort();
      log('Reserved random port: ' + backendPort);
    } catch (e) {
      log('ERROR: Could not reserve a free port: ' + e.message);
      backendPort = 8080; // fallback to historical default
    }
  }

  // Start backend first so it has time to initialize while splash is showing
  startBackend(backendPort);
  loadWindowSettings();
  createSplashWindow();
  createMainWindow(backendPort);
}

app.whenReady().then(boot);

// BUG-24 FIX: Kill backend on all exit paths, not just window-all-closed.
// On Windows, ChildProcess.kill() can leave the backend alive after the GUI
// exits, so terminate the exact spawned PID and its children.
const killBackend = (reason = 'shutdown') => {
  const child = backendProcess;
  backendProcess = null;

  if (child && child.pid) {
    terminateProcessTree(child.pid, reason);
  } else if (backendDataDir) {
    cleanupOrphanedBackendsForDataDir(backendDataDir);
  }
};

app.on('before-quit', () => killBackend('before-quit'));
app.on('window-all-closed', () => {
  killBackend('window-all-closed');
  app.quit();
});
process.on('SIGTERM', () => {
  killBackend('SIGTERM');
  process.exit(0);
});
process.on('SIGINT', () => {
  killBackend('SIGINT');
  process.exit(0);
});
