const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { classifyCoinFileSizes } = require('./coin-file-state.cjs');

process.stdout.write('[ELECTRON] Starting...\n');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow;
let splashWindow = null;
let backendProcess = null;
let backendPort = 0; // resolved before the backend is spawned
let activeThemeMenuItem = 'dark';
let backendDataDir = null;
let titleBarColor = '#C9CC3F';
let backgroundColor = null;
let qmailDetailBackgroundColor = null;
let attachmentPickerActive = false;
let coinFileState = {
  state: 'unknown',
  encryptedCount: 0,
  decryptedCount: 0,
  ignoredCount: 0,
};
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
const FALLBACK_ALERT_SOUND_FILES = [
  'default.mp3',
  'DingDing.mp3',
  'Floraphonic.mp3',
  'Notice.mp3',
  'Ploops.mp3',
];
const DEFAULT_TITLE_BAR_COLOR = '#C9CC3F';
const WINDOW_SETTINGS_FILE = 'qmail-window-settings.json';
const ZOOM_LEVEL_STEP = 0.5;
// Single source of truth for the version: version.json at the app root,
// stamped by scripts/stamp-version.cjs on every build. src/version.js
// imports the same file for the renderer.
const { buildDate: QMAIL_BUILD_DATE, buildNumber: QMAIL_BUILD_NUMBER } = require('./version.json');
const CHANGE_PASSWORDS_NEXT_BOOT_FILE = 'change_passwords_next_boot.txt';
// Keep in sync with src/qmail/supportConstants.js (renderer cannot require this file).
const SUPPORT_QMAIL_ADDRESS = '20.123@giga';
const QMAIL_HELP_MESSAGE =
`Contact
Telegram group: t.me/distributedmailsystem
QMail: ${SUPPORT_QMAIL_ADDRESS}
Email: CloudCoin@Protonmail.com`;
const CHANGE_PASSWORDS_NEXT_BOOT_TEXT =
`# QMail mailbox authenticity-number rotation
#
# If pown_on_restart is true, QMail will change the authenticity numbers
# for the Mailbox ID coin the next time this program starts.
#
# Authenticity numbers are shared secrets between your Mailbox ID and the
# RAIDA/QMail servers. Changing them is similar to changing the password for
# an online account: after the change completes, only this local copy of your
# Mailbox ID should contain the current authenticity numbers.
#
# Use this if your Mailbox ID key file may have been copied or compromised.
# The change prevents old copies of the key file from accessing your mailbox.
#
# Set the value to true, save this file, and restart QMail to rotate the
# authenticity numbers. QMail sets it back to false after a successful change.
pown_on_restart={VALUE}
`;

function formatBuildDateForDisplay(value = QMAIL_BUILD_DATE) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return String(value || '');

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatVersionForDisplay() {
  return `${formatBuildDateForDisplay()} (build ${QMAIL_BUILD_NUMBER})`;
}

// Absolute folder the program runs from. For the portable .exe,
// electron-builder unpacks to a temp dir and sets PORTABLE_EXECUTABLE_DIR
// to where the .exe actually sits — that is the folder users care about.
function getProgramDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (app.isPackaged) return path.dirname(app.getPath('exe'));
  return __dirname;
}

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

function buildSoundLabel(filename) {
  const base = String(filename || '').replace(/\.[^.]+$/, '').trim();
  return base || filename || 'Sound';
}

function listBuiltInAlertSoundsSync() {
  const dir = resolveSoundLibraryDir();

  try {
    const files = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => SOUND_FILE_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));

    if (files.length > 0) return files;
  } catch (error) {
    log('alert sound menu list failed for ' + dir + ': ' + error.message);
  }

  return FALLBACK_ALERT_SOUND_FILES;
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
  backgroundColor = normalizeHexColor(settings.backgroundColor);
  qmailDetailBackgroundColor = normalizeHexColor(settings.qmailDetailBackgroundColor);
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
  if (!windowRef || windowRef.isDestroyed()) {
    return { success: false, error: 'The application window is not available.' };
  }

  if (process.platform !== 'win32') {
    if (typeof windowRef.setBackgroundColor === 'function') {
      windowRef.setBackgroundColor(normalized);
    }
    return { success: true, color: normalized, nativeCaptionApplied: false };
  }

  const hwnd = getNativeWindowHandleDecimal(windowRef);
  if (!hwnd) {
    return { success: false, error: 'Could not resolve the native window handle.' };
  }

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
    "  Write-Error (\"DwmSetWindowAttribute results caption={0} text={1} border={2}\" -f $captionResult, $textResult, $borderResult)",
    "  exit 1",
    "}",
  ].join('\n');

  const result = runPowerShell(script, {
    // Windows PowerShell's Add-Type inherits compiler search paths. Developer
    // environments can leave stale LIB/INCLUDE entries behind, which prevents
    // this small framework-only P/Invoke wrapper from compiling at all.
    LIB: '',
    INCLUDE: '',
    QMAIL_WINDOW_HWND: hwnd,
    QMAIL_TITLE_BAR_COLORREF: String(colorRefFromHex(normalized)),
    QMAIL_TITLE_BAR_TEXT_COLORREF: String(colorRefFromHex(titleBarTextColorFor(normalized))),
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.error) {
    const error = result.error.message || 'PowerShell could not be started.';
    log('Title bar color failed: ' + error);
    return { success: false, error };
  }
  if (result.status !== 0) {
    const error = output || `PowerShell exited with status ${result.status}.`;
    log('Title bar color failed: ' + error);
    return { success: false, error };
  }

  if (typeof windowRef.setBackgroundColor === 'function') {
    windowRef.setBackgroundColor(normalized);
  }
  return { success: true, color: normalized, nativeCaptionApplied: true };
}

function setTitleBarColor(color, { persist = true } = {}) {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return { success: false, error: 'Color must be in #RRGGBB format' };
  }

  const applyResult = applyNativeTitleBarColor(mainWindow, normalized);
  if (!applyResult.success) {
    return {
      success: false,
      error: applyResult.error || 'Could not apply the title bar color.',
      color: titleBarColor,
      defaultColor: DEFAULT_TITLE_BAR_COLOR,
    };
  }

  titleBarColor = normalized;
  if (persist && !saveWindowSettings({ titleBarColor })) {
    buildApplicationMenu();
    return {
      success: false,
      error: 'The title bar color changed, but its setting could not be saved.',
      color: titleBarColor,
      defaultColor: DEFAULT_TITLE_BAR_COLOR,
    };
  }
  buildApplicationMenu();
  return { success: true, color: titleBarColor, defaultColor: DEFAULT_TITLE_BAR_COLOR };
}

function resetTitleBarColor() {
  return setTitleBarColor(DEFAULT_TITLE_BAR_COLOR);
}

function getAppearanceColors() {
  return {
    success: true,
    backgroundColor,
    qmailDetailBackgroundColor,
  };
}

function sendAppearanceColorsChanged() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('appearance:colors-changed', getAppearanceColors());
}

function setAppearanceColor(settingName, color) {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return { ...getAppearanceColors(), success: false, error: 'Color must be in #RRGGBB format' };
  }

  if (settingName === 'backgroundColor') {
    backgroundColor = normalized;
  } else if (settingName === 'qmailDetailBackgroundColor') {
    qmailDetailBackgroundColor = normalized;
  } else {
    return { ...getAppearanceColors(), success: false, error: 'Unknown appearance color setting' };
  }

  if (!saveWindowSettings({ [settingName]: normalized })) {
    buildApplicationMenu();
    sendAppearanceColorsChanged();
    return {
      ...getAppearanceColors(),
      success: false,
      error: 'The color changed, but its setting could not be saved.',
    };
  }

  buildApplicationMenu();
  sendAppearanceColorsChanged();
  return getAppearanceColors();
}

function resetAppearanceColor(settingName) {
  if (settingName === 'backgroundColor') {
    backgroundColor = null;
  } else if (settingName === 'qmailDetailBackgroundColor') {
    qmailDetailBackgroundColor = null;
  } else {
    return { ...getAppearanceColors(), success: false, error: 'Unknown appearance color setting' };
  }

  if (!saveWindowSettings({ [settingName]: null })) {
    buildApplicationMenu();
    sendAppearanceColorsChanged();
    return {
      ...getAppearanceColors(),
      success: false,
      error: 'The default color was restored, but the setting could not be saved.',
    };
  }

  buildApplicationMenu();
  sendAppearanceColorsChanged();
  return getAppearanceColors();
}

function showNativeTitleBarColorPicker() {
  if (process.platform !== 'win32') {
    sendTitleBarColorPickerCommand();
    return;
  }

  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$initial = [Environment]::GetEnvironmentVariable('QMAIL_INITIAL_COLOR')",
    "$dialog = New-Object System.Windows.Forms.ColorDialog",
    "$dialog.FullOpen = $true",
    "$dialog.AllowFullOpen = $true",
    "try { $dialog.Color = [System.Drawing.ColorTranslator]::FromHtml($initial) } catch {}",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  '#{0:X2}{1:X2}{2:X2}' -f $dialog.Color.R, $dialog.Color.G, $dialog.Color.B",
    "} else {",
    "  'CANCEL'",
    "}",
  ].join('\n');

  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-STA',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ], {
    encoding: 'utf8',
    env: { ...process.env, QMAIL_INITIAL_COLOR: titleBarColor },
    windowsHide: true,
  });

  const output = `${result.stdout || ''}`.trim().split(/\r?\n/).pop();
  if (result.error) {
    log('Title bar color picker failed: ' + result.error.message);
    return;
  }
  if (!output || output === 'CANCEL') return;

  const normalized = normalizeHexColor(output);
  if (!normalized) {
    log('Title bar color picker returned invalid color: ' + output);
    return;
  }
  const setResult = setTitleBarColor(normalized);
  if (!setResult.success) {
    log('Title bar color selection failed: ' + setResult.error);
  }
}

// BUG-51: CLI surface for QMail.exe. Parses our own flags; unrecognized
// OPTIONS trigger usage + exit, while harness-injected flags (--inspect*,
// --remote-debugging-port*, --no-sandbox) and positional args are
// tolerated so automation tooling can drive the app. Long-options are
// GNU style.
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
    // Flags injected by automation/debug harnesses (Playwright's _electron
    // launcher, `electron --inspect`). Electron/Chromium consume these;
    // they are not user input, so tolerate instead of exiting with usage.
    if (
      a.startsWith('--inspect') ||
      a.startsWith('--remote-debugging-port') ||
      a === '--no-sandbox'
    ) {
      continue;
    }
    // When a harness injects flags before the app path, Electron's
    // defaultApp arg shifting can land the app-dir positional inside our
    // slice. Positionals are never QMail options — skip them.
    if (!a.startsWith('-')) {
      continue;
    }
    if (a === '--help' || a === '-h') {
      process.stdout.write(QMAIL_USAGE + '\n');
      app.exit(0);
      return null;
    }
    if (a === '--version' || a === '-V') {
      process.stdout.write(`QMail ${formatVersionForDisplay()}\n`);
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
const windowIconPath = path.join(__dirname, isDev ? 'public' : 'dist', 'icon.png');
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

  // Platform-specific backend binary name: Windows ships core.exe,
  // Linux/macOS ship a bare `core` ELF. Both are placed under backend/
  // (in the repo for dev, in resources/backend for packaged builds).
  const backendBinary = process.platform === 'win32' ? 'core.exe' : 'core';

  if (isDev) {
    // Dev: binary lives next to the repo, data lives next to it too.
    // Keeps the dev loop simple.
    backendDir = path.join(__dirname, 'backend');
    backendPath = path.join(backendDir, backendBinary);
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
    backendPath = path.join(backendDir, backendBinary);
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

  // On Linux/macOS the bundled `core` ELF must be executable. Depending
  // on how the resource was staged, the exec bit may be missing — set it
  // defensively so spawn() doesn't fail with EACCES. No-op on Windows.
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(backendPath, 0o755);
    } catch (e) {
      log('WARN: could not chmod backend ' + backendPath + ': ' + e.message);
    }
  }

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
    icon: windowIconPath,
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
<title>QMail Beta</title>
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
    <div class="logo">QMail Beta</div>
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

function getQmailExecutablePath() {
  const packagedExecutable = [
    process.env.PORTABLE_EXECUTABLE_FILE,
    process.env.APPIMAGE,
  ]
    .map((value) => String(value || '').trim())
    .find((value) => value && path.isAbsolute(value));
  if (packagedExecutable) {
    return path.normalize(packagedExecutable);
  }
  return path.normalize(app.getPath('exe'));
}

function sendUpgradeRequested() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('qmail:upgrade-requested', {
    executablePath: getQmailExecutablePath(),
  });
}

function sendTitleBarColorPickerCommand() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('titlebar:pick-color', {
    color: titleBarColor,
    defaultColor: DEFAULT_TITLE_BAR_COLOR,
  });
}

function sendAlertSoundCommand(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('alerts:sound-command', payload);
}

async function chooseAlertSoundFile() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Alert Sound',
    properties: ['openFile'],
    filters: [
      { name: 'Audio files', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;

  sendAlertSoundCommand({
    action: 'set',
    soundFile: pathToFileURL(result.filePaths[0]).href,
  });
}

function setThemeFromMenu(themeId) {
  if (!isStandardTheme(themeId)) return;
  activeThemeMenuItem = themeId;
  buildApplicationMenu();
  sendThemeToRenderer(themeId);
}

// ---------------------------------------------------------------------------
// Recent coin locations ("Add Funds" sources and "Withdraw" destinations).
//
// Each list is stored one path per line, most recent first, in a file under
// Client_Data/ so the backend's GET /api/system/dropdown?file=<name> can
// serve the same list. The Electron main process owns the writes (core.exe
// has no write endpoint for dropdown files) — it spawns core.exe, so it
// knows where Client_Data is.
// ---------------------------------------------------------------------------
const DEPOSIT_LOCATIONS_FILE = 'deposit-locations.txt';
const WITHDRAW_LOCATIONS_FILE = 'withdraw-locations.txt';
// Backup destinations use the file name the public dropdown API documents
// (GET /api/system/dropdown?file=BackupPlaces.txt) — core auto-creates it.
const BACKUP_LOCATIONS_FILE = 'BackupPlaces.txt';
const MAX_RECENT_LOCATIONS = 15;

function getRecentLocationsPath(fileName) {
  if (!backendDataDir) return null;
  return path.join(backendDataDir, 'Client_Data', fileName);
}

// Windows paths are case-insensitive; compare accordingly so the same folder
// picked with different casing does not appear twice in the list.
const recentLocationKey = (value) =>
  process.platform === 'win32' ? String(value).toLowerCase() : String(value);

function readRecentLocations(fileName) {
  const filePath = getRecentLocationsPath(fileName);
  if (!filePath) return [];
  try {
    if (!fs.existsSync(filePath)) return [];
    const seen = new Set();
    const locations = [];
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const location = line.trim();
      if (!location) continue;
      const key = recentLocationKey(location);
      if (seen.has(key)) continue;
      seen.add(key);
      locations.push(location);
      if (locations.length >= MAX_RECENT_LOCATIONS) break;
    }
    return locations;
  } catch (error) {
    log('Could not read ' + fileName + ': ' + error.message);
    return [];
  }
}

function rememberRecentLocation(fileName, location) {
  const trimmed = String(location || '').trim();
  const filePath = getRecentLocationsPath(fileName);
  if (!trimmed || !filePath) return;

  const key = recentLocationKey(trimmed);
  const next = [
    trimmed,
    ...readRecentLocations(fileName).filter((entry) => recentLocationKey(entry) !== key),
  ].slice(0, MAX_RECENT_LOCATIONS);

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, next.join('\n') + '\n', 'utf8');
  } catch (error) {
    log('Could not write ' + fileName + ': ' + error.message);
    return;
  }
  // Keep the Wallet menu's location submenus in sync with the new list.
  buildApplicationMenu();
}

const readRecentDepositLocations = () => readRecentLocations(DEPOSIT_LOCATIONS_FILE);
const rememberDepositLocation = (location) =>
  rememberRecentLocation(DEPOSIT_LOCATIONS_FILE, location);
const readRecentWithdrawLocations = () => readRecentLocations(WITHDRAW_LOCATIONS_FILE);
const rememberWithdrawLocation = (location) =>
  rememberRecentLocation(WITHDRAW_LOCATIONS_FILE, location);
const readRecentBackupLocations = () => readRecentLocations(BACKUP_LOCATIONS_FILE);
const rememberBackupLocation = (location) =>
  rememberRecentLocation(BACKUP_LOCATIONS_FILE, location);

// Wallets for the File > Backup Wallet menu. wallet_paths.txt is the
// backend's wallet registry (one absolute path per line — it can include
// wallets outside Client_Data). Fall back to scanning Client_Data/Wallets
// when the registry is missing or empty.
function readWalletsForMenu() {
  if (!backendDataDir) return [];
  const clientData = path.join(backendDataDir, 'Client_Data');

  const seen = new Set();
  const wallets = [];
  const addWallet = (walletPath) => {
    const trimmed = String(walletPath || '').trim();
    if (!trimmed) return;
    const key = recentLocationKey(trimmed);
    if (seen.has(key)) return;
    try {
      if (!fs.statSync(trimmed).isDirectory()) return;
    } catch {
      return;
    }
    seen.add(key);
    wallets.push({ name: path.basename(trimmed) || trimmed, path: trimmed });
  };

  try {
    const registryPath = path.join(clientData, 'wallet_paths.txt');
    if (fs.existsSync(registryPath)) {
      for (const line of fs.readFileSync(registryPath, 'utf8').split(/\r?\n/)) {
        addWallet(line);
      }
    }
  } catch (error) {
    log('Could not read wallet_paths.txt: ' + error.message);
  }

  if (wallets.length === 0) {
    try {
      const walletsDir = path.join(clientData, 'Wallets');
      if (fs.existsSync(walletsDir)) {
        for (const entry of fs.readdirSync(walletsDir, { withFileTypes: true })) {
          if (entry.isDirectory()) addWallet(path.join(walletsDir, entry.name));
        }
      }
    } catch (error) {
      log('Could not scan Wallets directory: ' + error.message);
    }
  }

  return wallets;
}

function sendAppearanceColorPickerCommand(target) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('appearance:pick-color', {
    target,
    color: target === 'qmail-detail' ? qmailDetailBackgroundColor : backgroundColor,
  });
}

// Coin-file state is intentionally derived from the on-disk format instead of
// the loaded password. Current plaintext .bin files are <450 bytes and current
// encrypted .bin files are >600 bytes. Sizes in between are ignored so future
// formats do not get misclassified.
function detectCoinFileState() {
  const sizes = [];

  for (const wallet of readWalletsForMenu()) {
    for (const folderName of ['Bank', 'Fracked']) {
      const folderPath = path.join(wallet.path, folderName);
      let entries;
      try {
        entries = fs.readdirSync(folderPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.bin') {
          continue;
        }
        try {
          const size = fs.statSync(path.join(folderPath, entry.name)).size;
          sizes.push(size);
        } catch {
          sizes.push(null);
        }
      }
    }
  }

  return classifyCoinFileSizes(sizes);
}

function refreshCoinFileState({ rebuildMenu = false } = {}) {
  coinFileState = detectCoinFileState();
  if (rebuildMenu) buildApplicationMenu();
  return coinFileState;
}

const getCoinFileStateLabel = (state) => {
  if (state === 'encrypted') return 'Coin Files: Encrypted';
  if (state === 'decrypted') return 'Coin Files: Decrypted';
  return 'Coin Files: Mixed/Unknown';
};

// Where a picker should open when the caller did not name a location: the
// most recently used location from the given list that still exists on disk.
function resolvePickerStartLocation(preferredLocation, recentLocations) {
  const candidates = [preferredLocation, ...recentLocations];
  for (const candidate of candidates) {
    const location = String(candidate || '').trim();
    if (location && fs.existsSync(location)) return location;
  }
  return null;
}

async function pickCoinFilesFromDisk(defaultLocation = null) {
  const dialogOptions = {
    title: 'Choose CloudCoin files',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'CloudCoin files', extensions: ['bin', 'stack'] }],
  };
  const startLocation = resolvePickerStartLocation(defaultLocation, readRecentDepositLocations());
  if (startLocation) dialogOptions.defaultPath = startLocation;

  let result;
  try {
    result = await dialog.showOpenDialog(mainWindow, dialogOptions);
  } catch (error) {
    log('wallet:pickCoinFiles dialog error: ' + error.message);
    return [];
  }

  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return [];
  }

  rememberDepositLocation(path.dirname(result.filePaths[0]));

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
}

async function pickCoinFolderFromDisk(defaultLocation = null) {
  const dialogOptions = {
    title: 'Choose CloudCoin folder',
    properties: ['openDirectory'],
  };
  const startLocation = resolvePickerStartLocation(defaultLocation, readRecentDepositLocations());
  if (startLocation) dialogOptions.defaultPath = startLocation;

  let result;
  try {
    result = await dialog.showOpenDialog(mainWindow, dialogOptions);
  } catch (error) {
    log('wallet:pickCoinFolder dialog error: ' + error.message);
    return null;
  }

  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];
  rememberDepositLocation(folderPath);
  return {
    path: folderPath,
    name: path.basename(folderPath) || folderPath,
  };
}

async function pickWithdrawFolderFromDisk(defaultLocation = null) {
  const dialogOptions = {
    title: 'Choose withdraw destination folder',
    properties: ['openDirectory', 'createDirectory'],
  };
  const startLocation = resolvePickerStartLocation(defaultLocation, readRecentWithdrawLocations());
  if (startLocation) dialogOptions.defaultPath = startLocation;

  let result;
  try {
    result = await dialog.showOpenDialog(mainWindow, dialogOptions);
  } catch (error) {
    log('wallet:pickWithdrawFolder dialog error: ' + error.message);
    return null;
  }

  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];
  rememberWithdrawLocation(folderPath);
  return {
    path: folderPath,
    name: path.basename(folderPath) || folderPath,
  };
}

// Menu entry point for the folder and individual-file Add Funds actions. Runs
// the picker (seeded with the chosen recent location, if any) and only then
// tells the renderer to open the Add Funds modal with the selection filled in.
async function addFundsFromMenu(method, location = null) {
  if (method === 'files') {
    const files = await pickCoinFilesFromDisk(location);
    if (files.length > 0) {
      sendQmailMenuCommand({ command: 'add-funds', method: 'files', files });
    }
    return;
  }
  const folder = await pickCoinFolderFromDisk(location);
  if (folder) {
    sendQmailMenuCommand({ command: 'add-funds', method: 'folder', folder });
  }
}

// Submenu shared by the folder and individual-file actions: the recent
// deposit locations (most recent first), then "Choose New Location…" which
// opens the picker in the last-used folder.
function buildDepositLocationMenuItems(method) {
  const items = readRecentDepositLocations().map((location) => ({
    label: location,
    click: () => addFundsFromMenu(method, location),
  }));
  if (items.length > 0) items.push({ type: 'separator' });
  items.push({
    label: 'Choose New Location…',
    click: () => addFundsFromMenu(method, null),
  });
  return items;
}

// Menu entry point for Wallet > Withdraw Funds > .bin File. A location
// chosen from the recent list goes straight to the Withdraw modal (which
// prompts for amount and memo); "Choose New Location…" runs the folder
// picker first, seeded with the last-used destination.
async function withdrawToBinFromMenu(location = null) {
  let destination = null;
  if (location) {
    rememberWithdrawLocation(location); // bump to most-recent
    destination = { path: location, name: path.basename(location) || location };
  } else {
    destination = await pickWithdrawFolderFromDisk(null);
  }
  if (destination) {
    sendQmailMenuCommand({ command: 'withdraw-funds', method: 'file', destination });
  }
}

// Submenu for ".bin File": recent withdraw destinations (most recent first),
// then "Choose New Location…" which opens the picker in the last-used folder.
function buildWithdrawLocationMenuItems() {
  const items = readRecentWithdrawLocations().map((location) => ({
    label: location,
    click: () => withdrawToBinFromMenu(location),
  }));
  if (items.length > 0) items.push({ type: 'separator' });
  items.push({
    label: 'Choose New Location…',
    click: () => withdrawToBinFromMenu(null),
  });
  return items;
}

async function pickBackupFolderFromDisk(defaultLocation = null) {
  const dialogOptions = {
    title: 'Choose backup destination folder',
    properties: ['openDirectory', 'createDirectory'],
  };
  const startLocation = resolvePickerStartLocation(defaultLocation, readRecentBackupLocations());
  if (startLocation) dialogOptions.defaultPath = startLocation;

  let result;
  try {
    result = await dialog.showOpenDialog(mainWindow, dialogOptions);
  } catch (error) {
    log('backup folder dialog error: ' + error.message);
    return null;
  }

  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];
  rememberBackupLocation(folderPath);
  return {
    path: folderPath,
    name: path.basename(folderPath) || folderPath,
  };
}

// Menu entry point for File > Backup Wallet > <wallet> > <location>. A
// location chosen from the recent list starts the backup right away;
// "Choose New Location…" runs the folder picker first. The renderer calls
// POST /api/wallets/backup and reveals the finished ZIP.
async function backupWalletFromMenu(wallet, location = null) {
  let destination = null;
  if (location) {
    rememberBackupLocation(location); // bump to most-recent
    destination = { path: location, name: path.basename(location) || location };
  } else {
    destination = await pickBackupFolderFromDisk(null);
  }
  if (destination) {
    sendQmailMenuCommand({ command: 'backup-wallet', wallet, destination });
  }
}

// Per-wallet submenu of recent backup destinations, then "Choose New
// Location…". Note: core rejects destinations inside Client_Data.
function buildBackupLocationMenuItems(wallet) {
  const items = readRecentBackupLocations().map((location) => ({
    label: location,
    click: () => backupWalletFromMenu(wallet, location),
  }));
  if (items.length > 0) items.push({ type: 'separator' });
  items.push({
    label: 'Choose New Location…',
    click: () => backupWalletFromMenu(wallet, null),
  });
  return items;
}

// File > Backup Wallet: one submenu per known wallet.
function buildBackupWalletMenuItems() {
  const wallets = readWalletsForMenu();
  if (wallets.length === 0) {
    return [{ label: 'No wallets found', enabled: false }];
  }
  return wallets.map((wallet) => ({
    label: wallet.name,
    submenu: buildBackupLocationMenuItems(wallet),
  }));
}

function buildApplicationMenu() {
  coinFileState = detectCoinFileState();
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
        {
          label: 'Backup Wallet',
          submenu: buildBackupWalletMenuItems(),
        },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ],
    },
    {
      label: 'Wallet',
      submenu: [
        {
          label: 'Add Funds',
          submenu: [
            {
              label: 'Import All Coins from Folder',
              submenu: buildDepositLocationMenuItems('folder'),
            },
            {
              label: 'Import Selected Coin Files…',
              submenu: buildDepositLocationMenuItems('files'),
            },
            {
              label: 'From Locker…',
              click: () => sendQmailMenuCommand({ command: 'add-funds', method: 'locker' }),
            },
          ],
        },
        {
          label: 'Withdraw Funds',
          submenu: [
            {
              label: 'Locker Key…',
              click: () => sendQmailMenuCommand({ command: 'withdraw-funds', method: 'locker' }),
            },
            {
              label: '.bin File',
              submenu: buildWithdrawLocationMenuItems(),
            },
          ],
        },
        {
          label: 'Purchase Coins',
          click: () => shell.openExternal('https://cloudcoin.com/pay/'),
        },
      ],
    },
    {
      label: 'Security',
      submenu: [
        {
          label: getCoinFileStateLabel(coinFileState.state),
          enabled: false,
        },
        { type: 'separator' },
        {
          label: 'Encrypt Coins',
          enabled: coinFileState.state !== 'encrypted',
          click: () => sendQmailMenuCommand('security-encrypt-coins'),
        },
        {
          label: 'Decrypt Coins',
          enabled: coinFileState.state !== 'decrypted',
          click: () => sendQmailMenuCommand('security-decrypt-coins'),
        },
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
      ],
    },
    {
      label: 'Mailbox',
      submenu: [
        {
          label: 'Compose',
          click: () => sendQmailMenuCommand('compose-new'),
        },
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
        { type: 'separator' },
        {
          label: 'Mark all as read',
          click: () => sendQmailMenuCommand('mark-all-read'),
        },
        { type: 'separator' },
        // Mail-control settings (stored on the public DRD record, but they
        // govern what this MAILBOX accepts — hence they live here).
        {
          label: 'Set Inbox Fee…',
          click: () => sendQmailMenuCommand('mailbox-inbox-fee'),
        },
        {
          label: 'Set Lowest Accepted Class…',
          click: () => sendQmailMenuCommand('mailbox-class'),
        },
      ],
    },
    {
      label: 'Profile',
      submenu: [
        { label: 'Edit White List', click: () => sendQmailMenuCommand('profile-whitelist') },
        { label: 'Edit Black List', click: () => sendQmailMenuCommand('profile-blacklist') },
        { type: 'separator' },
        { label: 'Edit Your Symbols', click: () => sendQmailMenuCommand('profile-symbols') },
        { label: 'Edit Your Name', click: () => sendQmailMenuCommand('profile-name') },
        { label: 'Edit Your Description', click: () => sendQmailMenuCommand('profile-description') },
        { type: 'separator' },
        { label: 'Find Users…', click: () => sendQmailMenuCommand('profile-find-users') },
        { type: 'separator' },
        { label: 'Link Devices (Coming Soon)', enabled: false },
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
          click: () => showNativeTitleBarColorPicker(),
        },
        {
          label: 'Reset Title Bar Color',
          enabled: titleBarColor !== DEFAULT_TITLE_BAR_COLOR,
          click: () => resetTitleBarColor(),
        },
        {
          label: 'Background Color...',
          click: () => sendAppearanceColorPickerCommand('background'),
        },
        {
          label: 'Reset Background Color',
          enabled: Boolean(backgroundColor),
          click: () => resetAppearanceColor('backgroundColor'),
        },
        {
          label: 'QMail Detail Background Color...',
          click: () => sendAppearanceColorPickerCommand('qmail-detail'),
        },
        {
          label: 'Reset QMail Detail Background Color',
          enabled: Boolean(qmailDetailBackgroundColor),
          click: () => resetAppearanceColor('qmailDetailBackgroundColor'),
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
      label: 'Alerts',
      submenu: [
        {
          label: 'Built-in Sounds',
          submenu: [
            {
              label: 'No Sound',
              click: () => sendAlertSoundCommand({ action: 'set', soundFile: '' }),
            },
            { type: 'separator' },
            ...listBuiltInAlertSoundsSync().map((filename) => ({
              label: buildSoundLabel(filename),
              click: () => sendAlertSoundCommand({ action: 'set', soundFile: filename }),
            })),
          ],
        },
        {
          label: 'Choose Sound File...',
          click: () => chooseAlertSoundFile(),
        },
        { type: 'separator' },
        {
          label: 'Preview Alert Sound',
          click: () => sendAlertSoundCommand({ action: 'preview' }),
        },
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
          label: 'Contact',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Contact',
            message: 'Contact',
            detail: QMAIL_HELP_MESSAGE,
            buttons: ['OK'],
          }),
        },
        {
          label: 'Send Logs To Support',
          click: async () => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            const { response } = await dialog.showMessageBox(mainWindow, {
              type: 'question',
              title: 'Send Logs To Support',
              message: 'Send diagnostic logs to support?',
              detail:
                `This creates a support archive (main.log, recent receipts, ` +
                `transaction logs) and sends it by QMail to ${SUPPORT_QMAIL_ADDRESS}.\n\n` +
                `Do not send if you do not want that data shared with support.`,
              buttons: ['Cancel', 'Send Logs'],
              defaultId: 1,
              cancelId: 0,
              noLink: true,
            });
            if (response === 1) {
              sendQmailMenuCommand('send-logs-to-support');
            }
          },
        },
        {
          label: 'Upgrade',
          click: () => sendUpgradeRequested(),
        },
        { type: 'separator' },
        {
          label: 'Report Bugs',
          click: () => shell.openExternal('http://cloudcoin.org/bugs.php'),
        },
        { type: 'separator' },
        {
          // app.name is "q-mail" (package.json) — display the product name.
          label: 'About QMail',
          click: () => shell.openExternal('https://www.distributedmailsystem.com/faq'),
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
    icon: windowIconPath,
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

  // Handle zoom shortcuts explicitly. Electron's menu-role accelerators do
  // not consistently receive Ctrl+Plus/Ctrl+Minus on every keyboard layout,
  // particularly when Plus requires Shift or comes from the numeric keypad.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || (!input.control && !input.meta) || input.alt) {
      return;
    }

    const isZoomIn =
      input.key === '+' ||
      input.key === '=' ||
      input.code === 'Equal' ||
      input.code === 'NumpadAdd';
    const isZoomOut =
      input.key === '-' ||
      input.code === 'Minus' ||
      input.code === 'NumpadSubtract';

    if (!isZoomIn && !isZoomOut) return;

    event.preventDefault();
    const direction = isZoomIn ? 1 : -1;
    mainWindow.webContents.setZoomLevel(
      mainWindow.webContents.getZoomLevel() + direction * ZOOM_LEVEL_STEP
    );
  });

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

ipcMain.handle('get-app-version', () => formatVersionForDisplay());

ipcMain.handle('get-app-dir', () => getProgramDir());

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

ipcMain.handle('appearance:get-colors', () => getAppearanceColors());

ipcMain.handle('appearance:set-background-color', (_event, color) => {
  return setAppearanceColor('backgroundColor', color);
});

ipcMain.handle('appearance:reset-background-color', () => {
  return resetAppearanceColor('backgroundColor');
});

ipcMain.handle('appearance:set-qmail-detail-background-color', (_event, color) => {
  return setAppearanceColor('qmailDetailBackgroundColor', color);
});

ipcMain.handle('appearance:reset-qmail-detail-background-color', () => {
  return resetAppearanceColor('qmailDetailBackgroundColor');
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

ipcMain.handle('coin-encryption:get-file-state', () => {
  return refreshCoinFileState({ rebuildMenu: true });
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
ipcMain.handle('compose:pickFiles', async (event) => {
  if (attachmentPickerActive) {
    log('compose:pickFiles ignored because an attachment picker is already open');
    return [];
  }

  const ownerWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (!ownerWindow || ownerWindow.isDestroyed()) {
    log('compose:pickFiles ignored because its owner window is unavailable');
    return [];
  }

  attachmentPickerActive = true;
  let result;
  try {
    result = await dialog.showOpenDialog(ownerWindow, {
      title: 'Attach files',
      properties: ['openFile', 'multiSelections'],
    });
  } catch (error) {
    log('compose:pickFiles dialog error: ' + error.message);
    return [];
  } finally {
    attachmentPickerActive = false;

    // Native file dialogs are window-attached sheets on macOS. Reassert the
    // owning window and application menu after the sheet closes; this also
    // recovers the menu bar on Windows/Linux if a platform dialog disturbed
    // its visibility.
    if (!ownerWindow.isDestroyed()) {
      const applicationMenu = Menu.getApplicationMenu();
      if (applicationMenu) {
        Menu.setApplicationMenu(applicationMenu);
      } else {
        buildApplicationMenu();
      }
      if (process.platform === 'darwin') {
        app.focus();
      }
      if (process.platform !== 'darwin' &&
          typeof ownerWindow.setMenuBarVisibility === 'function') {
        ownerWindow.setMenuBarVisibility(true);
      }
      ownerWindow.focus();
    }
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

// Sent-box attachment metadata (docs/attachment.views.txt): fetch the send
// receipt from the local backend and sanitize it HERE so the raw receipt
// (wallet paths, locker codes, operation IDs, per-stripe transfer data)
// never reaches the renderer. Keep the mapping in sync with
// sanitizeReceiptAttachmentFiles in src/api/qmailApiServices.js, which is
// the browser-build fallback.
async function getSentAttachmentMetadata(apiPort, emailId) {
  const id = String(emailId || '');
  const port = Number(apiPort);
  if (
    !/^[0-9a-fA-F]{32}$/.test(id) ||
    !Number.isInteger(port) ||
    port !== backendPort
  ) {
    return { success: false, error: 'Invalid receipt request.' };
  }

  try {
    const response = await fetch(`http://localhost:${port}/api/qmail/receipts?guid=${id}`);
    // No receipt (send predates receipts): definitively no metadata.
    if (response.status === 404) {
      return { success: true, data: { attachments: [] } };
    }
    if (!response.ok) {
      return { success: false, error: `Receipt request failed (${response.status}).` };
    }

    const data = await response.json();
    const receipt = (data && data.receipt) || data;
    const files =
      (receipt && receipt.upload && receipt.upload.files) ||
      (receipt && receipt.files);
    const FAILED_STATUSES = new Set(['failed', 'error', 'cancelled']);
    const attachments = (Array.isArray(files) ? files : [])
      .filter((file) => String(file.role || '').toLowerCase() === 'attachment')
      .filter((file) => !FAILED_STATUSES.has(String(file.status || '').toLowerCase()))
      .map((file, index) => {
        const sourcePath = typeof file.source === 'string' ? file.source : '';
        const name =
          file.name || sourcePath.split(/[\\/]/).pop() || `Attachment ${index + 1}`;
        const dotIndex = name.lastIndexOf('.');
        return {
          attachmentId: `receipt-${index}`,
          name,
          fileExtension: dotIndex > 0 ? name.slice(dotIndex + 1) : '',
          size: Number(file.size_bytes ?? file.size) || 0,
          sourcePath,
          metadataOnly: true,
        };
      });

    return { success: true, data: { attachments } };
  } catch (error) {
    log('qmail:sent-attachment-metadata failed: ' + error.message);
    return { success: false, error: error.message };
  }
}

ipcMain.handle('qmail:sent-attachment-metadata', async (_event, apiPort, emailId) => {
  return getSentAttachmentMetadata(apiPort, emailId);
});

// Sent-box full recipient lists (to/cc/bcc) from the local send receipt.
// Same validation and sanitization boundary as getSentAttachmentMetadata:
// the raw receipt never reaches the renderer. Used to enable Reply All on
// multi-recipient sent mail (list rows only carry recipient_address + count).
async function getSentRecipients(apiPort, emailId) {
  const id = String(emailId || '');
  const port = Number(apiPort);
  if (
    !/^[0-9a-fA-F]{32}$/.test(id) ||
    !Number.isInteger(port) ||
    port !== backendPort
  ) {
    return { success: false, error: 'Invalid receipt request.' };
  }

  try {
    const response = await fetch(`http://localhost:${port}/api/qmail/receipts?guid=${id}`);
    // No receipt (send predates receipts): empty lists, success true.
    if (response.status === 404) {
      return { success: true, data: { to: [], cc: [], bcc: [] } };
    }
    if (!response.ok) {
      return { success: false, error: `Receipt request failed (${response.status}).` };
    }

    const data = await response.json();
    const receipt = (data && data.receipt) || data;
    const rows =
      receipt && receipt.tell && Array.isArray(receipt.tell.recipients)
        ? receipt.tell.recipients
        : [];

    const denomNames = ['bit', 'byte', 'kilo', 'mega', 'giga', 'epic'];
    const formatFromSnDenom = (snRaw, denomRaw) => {
      const sn = Number(snRaw);
      const denom = Number(denomRaw);
      if (!Number.isInteger(sn) || sn <= 0 || sn > 0xffffff) return '';
      if (!Number.isInteger(denom) || denom < 0 || denom >= denomNames.length) {
        return '';
      }
      const word = denomNames[denom];
      const b1 = Math.floor(sn / 65536) % 256;
      const b2 = Math.floor(sn / 256) % 256;
      const b3 = sn % 256;
      if (b1 !== 0) return `${b1}.${b2}.${b3}@${word}`;
      if (b2 !== 0) return `${b2}.${b3}@${word}`;
      return `${b3}@${word}`;
    };

    const to = [];
    const cc = [];
    const bcc = [];
    for (const row of rows) {
      // Prefer stored address; older receipts left address blank — rebuild
      // from serial_number + denomination so multi-recipient Sent still works.
      let address =
        typeof row?.address === 'string' ? row.address.trim() : '';
      if (!address) {
        address = formatFromSnDenom(
          row?.serial_number ?? row?.serialNumber,
          row?.denomination ?? row?.denomination_code,
        );
      }
      if (!address) continue;
      const kind = String(row?.kind || 'to').toLowerCase();
      if (kind === 'cc') {
        cc.push(address);
      } else if (kind === 'bcc') {
        bcc.push(address);
      } else {
        // "to" and any unknown kind land in To.
        to.push(address);
      }
    }

    return { success: true, data: { to, cc, bcc } };
  } catch (error) {
    log('qmail:sent-recipients failed: ' + error.message);
    return { success: false, error: error.message };
  }
}

ipcMain.handle('qmail:sent-recipients', async (_event, apiPort, emailId) => {
  return getSentRecipients(apiPort, emailId);
});

// Resolve the path from the authoritative local receipt. The renderer only
// supplies IDs and therefore cannot use this channel to reveal arbitrary files.
ipcMain.handle('qmail:reveal-sent-attachment', async (
  _event,
  apiPort,
  emailId,
  attachmentId,
) => {
  const metadata = await getSentAttachmentMetadata(apiPort, emailId);
  if (!metadata.success) return metadata;

  const requestedId = String(attachmentId || '');
  const attachment = metadata.data.attachments.find(
    (entry) => entry.attachmentId === requestedId,
  );
  if (!attachment) {
    return { success: false, error: 'Sent attachment metadata was not found.' };
  }

  const sourcePath = String(attachment.sourcePath || '').trim();
  if (!sourcePath || !path.isAbsolute(sourcePath)) {
    return { success: false, error: 'The original attachment location is unavailable.' };
  }

  try {
    const resolvedPath = await fs.promises.realpath(sourcePath);
    const stat = await fs.promises.stat(resolvedPath);
    if (!stat.isFile()) {
      return { success: false, error: 'The original attachment is no longer a file.' };
    }
    shell.showItemInFolder(resolvedPath);
    return { success: true, path: resolvedPath };
  } catch {
    return {
      success: false,
      error: 'The original attachment has been moved or deleted.',
    };
  }
});

ipcMain.handle('wallet:pickCoinFiles', async (_event, options) => {
  return pickCoinFilesFromDisk(options?.defaultPath || null);
});

ipcMain.handle('wallet:pickCoinFolder', async (_event, options) => {
  return pickCoinFolderFromDisk(options?.defaultPath || null);
});

ipcMain.handle('wallet:pickWithdrawFolder', async (_event, options) => {
  return pickWithdrawFolderFromDisk(options?.defaultPath || null);
});

// Open Explorer/Finder on a file the backend just wrote (a .bin withdrawal
// or a wallet-backup ZIP). Only destinations the user actually picked — they
// are recorded in the given recent-locations list at pick time — can be
// revealed, so the renderer cannot use this to open arbitrary paths.
async function revealFileInKnownLocation(payload, knownLocations) {
  try {
    const destination = String(payload?.destination || '').trim();
    if (!destination) return { success: false, error: 'Destination is empty.' };

    const destinationKey = recentLocationKey(path.resolve(destination));
    const isKnown = knownLocations.some(
      (location) => recentLocationKey(path.resolve(location)) === destinationKey,
    );
    if (!isKnown) {
      return { success: false, error: 'Opening this folder is not permitted.' };
    }

    // Highlight the file when we know its name and it exists; otherwise
    // just open the destination folder.
    const filename = String(payload?.filename || '').trim();
    if (filename && path.basename(filename) === filename) {
      const filePath = path.join(destination, filename);
      if (fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath);
        return { success: true };
      }
    }

    const openError = await shell.openPath(destination);
    if (openError) return { success: false, error: openError };
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

ipcMain.handle('wallet:revealWithdrawnFile', async (_event, payload) => {
  return revealFileInKnownLocation(payload, readRecentWithdrawLocations());
});

ipcMain.handle('wallet:revealBackupZip', async (_event, payload) => {
  return revealFileInKnownLocation(payload, readRecentBackupLocations());
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

function getClientDataDir() {
  return backendDataDir ? path.join(backendDataDir, 'Client_Data') : null;
}

function getChangePasswordsFilePath() {
  const clientDataDir = getClientDataDir();
  return clientDataDir ? path.join(clientDataDir, CHANGE_PASSWORDS_NEXT_BOOT_FILE) : null;
}

function renderChangePasswordsFile(enabled) {
  return CHANGE_PASSWORDS_NEXT_BOOT_TEXT.replace('{VALUE}', enabled ? 'true' : 'false');
}

function readPownOnRestartValue(content) {
  if (typeof content !== 'string') return null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^pown_on_restart\s*=\s*(true|false|1|0|yes|no)\s*$/i.exec(line);
    if (match) {
      return ['true', '1', 'yes'].includes(match[1].toLowerCase());
    }
  }
  return null;
}

function writePownOnRestartValue(enabled) {
  const clientDataDir = getClientDataDir();
  const filePath = getChangePasswordsFilePath();
  if (!clientDataDir || !filePath) {
    return { success: false, error: 'Data directory not available' };
  }

  fs.mkdirSync(clientDataDir, { recursive: true });
  fs.writeFileSync(filePath, renderChangePasswordsFile(enabled), 'utf8');
  return { success: true, filePath, pown_on_restart: Boolean(enabled) };
}

function ensureChangePasswordsFile() {
  const filePath = getChangePasswordsFilePath();
  if (!filePath) {
    return { success: false, error: 'Data directory not available' };
  }

  if (!fs.existsSync(filePath)) {
    return {
      ...writePownOnRestartValue(true),
      created: true,
    };
  }

  return { success: true, filePath, created: false };
}

function readWalletRegistryPaths(clientDataDir) {
  const registryPath = path.join(clientDataDir, 'wallet_paths.txt');
  try {
    const content = fs.readFileSync(registryPath, 'utf8');
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

function resolveMailWalletPath() {
  const clientDataDir = getClientDataDir();
  if (!clientDataDir) return null;

  const paths = readWalletRegistryPaths(clientDataDir);
  const mailPath = paths.find((walletPath) => {
    const normalized = walletPath.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
    return normalized.endsWith('/wallets/mail') || normalized.endsWith('/mail');
  });

  if (mailPath) return mailPath;
  return path.join(clientDataDir, 'Wallets', 'Mail');
}

function findBootPownSourceFolder(mailWalletPath) {
  const candidates = [
    path.join(mailWalletPath, 'Bank'),
    path.join(mailWalletPath, 'Fracked'),
  ];

  for (const folderPath of candidates) {
    if (fs.existsSync(folderPath) && dirHasCoinFile(folderPath)) {
      return folderPath;
    }
  }

  return null;
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

ipcMain.handle('qmail:get-boot-pown-plan', async () => {
  try {
    const ensured = ensureChangePasswordsFile();
    if (!ensured.success) return ensured;

    const filePath = getChangePasswordsFilePath();
    const content = fs.readFileSync(filePath, 'utf8');
    const enabled = readPownOnRestartValue(content);
    if (enabled !== true) {
      return {
        success: true,
        shouldPown: false,
        filePath,
        pown_on_restart: enabled === null ? false : enabled,
      };
    }

    const walletPath = resolveMailWalletPath();
    if (!walletPath) {
      return {
        success: false,
        shouldPown: true,
        filePath,
        error: 'Mail wallet path could not be resolved',
      };
    }

    const sourceFolder = findBootPownSourceFolder(walletPath);
    if (!sourceFolder) {
      return {
        success: true,
        shouldPown: false,
        pown_on_restart: true,
        filePath,
        walletPath,
        error: 'No Mail wallet ID coin found in Bank or Fracked',
      };
    }

    return {
      success: true,
      shouldPown: true,
      filePath,
      walletPath,
      sourceFolder,
      memo: 'POWN',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('qmail:set-pown-on-restart', async (_event, enabled) => {
  try {
    return writePownOnRestartValue(Boolean(enabled));
  } catch (error) {
    return { success: false, error: error.message };
  }
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
