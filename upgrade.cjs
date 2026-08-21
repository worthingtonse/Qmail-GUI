// ===========================================================================
//  IN-PLACE UPGRADE — download the new launcher and swap it over this one
// ===========================================================================
//
//  Replaces the file the user double-clicked (portable QMail.exe on
//  Windows, QMail.AppImage on Linux) with the latest published build from
//  https://cloudcoinconsortium.com/bin/. User data is untouched by
//  construction: wallets and mail live in sibling directories
//  (Client_Data/ etc.), and this module only ever creates, renames, or
//  deletes three paths — the target and its ".new" / ".old" siblings.
//
//  WHY RENAME, NOT OVERWRITE: Windows locks a running .exe against write
//  and delete but allows RENAME on the same volume. So the swap is:
//  download to <target>.new (same directory, so the renames stay
//  same-volume and atomic), verify SHA-256, rename target -> .old, rename
//  .new -> target, relaunch. The .old cannot be deleted while the old
//  launcher still runs; the next startup deletes it (cleanupLeftovers).
//
//  macOS is deliberately unsupported here (an .app bundle in a .dmg needs
//  a different installer flow); mobile never self-replaces. Callers use
//  resolveUpgradeTarget() to decide whether to offer "Upgrade Now" at all.
//
//  No require('electron') in this file — everything Electron-specific
//  (IPC, relaunch, window messaging) stays in electron.cjs so this module
//  is testable in plain Node.
//
// ===========================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const { buildDate: LOCAL_BUILD_DATE } = require('./version.json');

// Only this origin may ever be downloaded from. Full-URL prefix is safe
// here (unlike a bare hostname strncmp) because the trailing slash means
// "cloudcoinconsortium.com.evil.tld" cannot match.
const DOWNLOAD_BASE_URL = 'https://cloudcoinconsortium.com/bin/';

// Canonical public names (what use.php links) and the immutable dated
// pattern CI publishes alongside them. Canonical is tried first per
// Sean's preference; the dated name is the retry when a mid-promotion
// race makes the canonical bytes disagree with SHA256SUMS.
const CATALOG = Object.freeze({
  windows: {
    canonical: 'QMail.exe',
    dated: (date) => `qmail-windows-${date}.exe`,
  },
  'linux-app': {
    canonical: 'QMail.AppImage',
    dated: (date) => `qmail-linux-desktop-${date}.AppImage`,
  },
});

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SUMS_FETCH_TIMEOUT_MS = 30_000;
const DOWNLOAD_STALL_TIMEOUT_MS = 60_000;
const DOWNLOAD_TOTAL_TIMEOUT_MS = 15 * 60_000;
// ~16s total. The long tail is deliberate: Windows Defender scans a
// freshly written 60+ MB unsigned executable on close, and holds it as
// EBUSY for well over the few seconds a short backoff covers (observed in
// acceptance testing 2026-08-20). File-sync tools (OneDrive) behave the
// same on synced folders like Desktop.
const RENAME_RETRY_DELAYS_MS = [0, 250, 500, 1000, 2000, 4000, 8000];

let activeAbort = null; // AbortController of the in-flight download, if any

// Set only when performUpgrade completed a verified swap. The restart IPC
// is a no-op without it, so a renderer (or injected script) can never use
// "restart" as a free kill-the-backend-and-respawn primitive.
let installedAwaitingRestart = false;

/** One-shot check-and-clear of the "a swap actually happened" latch. */
function consumeInstalledLatch() {
  const was = installedAwaitingRestart;
  installedAwaitingRestart = false;
  return was;
}

const noop = () => {};

/**
 * Where and whether this build can upgrade itself.
 *
 * @returns {{supported: boolean, reason: string|null,
 *            targetPath: string|null, platformKey: string|null}}
 */
function resolveUpgradeTarget() {
  const portable = String(process.env.PORTABLE_EXECUTABLE_FILE || '').trim();
  if (process.platform === 'win32' && portable && path.isAbsolute(portable)) {
    return {
      supported: true,
      reason: null,
      targetPath: path.normalize(portable),
      platformKey: 'windows',
    };
  }

  const appImage = String(process.env.APPIMAGE || '').trim();
  if (process.platform === 'linux' && appImage && path.isAbsolute(appImage)) {
    return {
      supported: true,
      reason: null,
      targetPath: path.normalize(appImage),
      platformKey: 'linux-app',
    };
  }

  // Anything else — dev runs (no portable env), macOS, an unpacked build
  // launched directly — has no launcher file we can safely replace.
  return {
    supported: false,
    reason:
      process.platform === 'darwin'
        ? 'mac-manual'
        : 'not-a-packaged-launcher',
    targetPath: null,
    platformKey: null,
  };
}

/**
 * Delete leftovers from a previous upgrade: the renamed-away ".old"
 * launcher (undeletable at swap time because it was still running) and
 * any orphaned ".new" from an interrupted download. Call once at startup,
 * before anything else touches the launcher directory.
 */
function cleanupLeftovers(targetPath, log = noop) {
  for (const suffix of ['.old', '.new']) {
    const leftover = targetPath + suffix;
    try {
      if (fs.existsSync(leftover)) {
        fs.unlinkSync(leftover);
        log(`upgrade: removed leftover ${leftover}`);
      }
    } catch (e) {
      // A locked .old (another instance still exiting) is fine — the next
      // start gets it.
      log(`upgrade: could not remove ${leftover}: ${e.message}`);
    }
  }
}

/** Parse GNU sha256sum output: "<64 hex>  <filename>" per line. */
function parseSha256Sums(text) {
  const map = new Map();
  for (const line of String(text || '').split('\n')) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (match) map.set(match[2], match[1].toLowerCase());
  }
  return map;
}

async function fetchSha256Sums(signal) {
  let response;
  let text;
  try {
    response = await fetch(`${DOWNLOAD_BASE_URL}SHA256SUMS`, {
      signal: anySignal(signal, AbortSignal.timeout(SUMS_FETCH_TIMEOUT_MS)),
    });
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }
    text = await response.text();
  } catch (e) {
    // Preserve a user cancel; label everything else (timeout, network,
    // bad status) as a 'sums' failure rather than a generic 'download'.
    if (e && e.upgradeCode === 'cancelled') throw e;
    throw upgradeError('sums', `Could not fetch SHA256SUMS: ${e.message || e}`);
  }
  const sums = parseSha256Sums(text);
  if (sums.size === 0) {
    throw upgradeError('sums', 'SHA256SUMS is empty or unparseable');
  }
  return sums;
}

// AbortSignal.any exists from Node 20; Electron builds in the field may
// carry Node 18, so combine signals by hand.
function anySignal(...signals) {
  const present = signals.filter(Boolean);
  if (present.length === 1) return present[0];
  const controller = new AbortController();
  for (const signal of present) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}

function upgradeError(code, message) {
  const error = new Error(message);
  error.upgradeCode = code;
  return error;
}

async function freeBytesIn(dir) {
  try {
    const stats = await fs.promises.statfs(dir);
    return Number(stats.bsize) * Number(stats.bavail);
  } catch {
    return null; // statfs unavailable — skip the check rather than block
  }
}

/**
 * Stream one URL to stagedPath, hashing as it lands. Enforces a stall
 * timeout (no bytes for DOWNLOAD_STALL_TIMEOUT_MS aborts) on top of an
 * overall ceiling, and checks free disk space once the size is known —
 * users run QMail from USB sticks, where both matter.
 *
 * @returns {Promise<string>} lowercase hex SHA-256 of the written file
 */
async function downloadTo(url, stagedPath, { signal, onProgress, log }) {
  const stall = new AbortController();
  let stallTimer = null;
  const resetStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(
      () => stall.abort(upgradeError('download', 'Download stalled')),
      DOWNLOAD_STALL_TIMEOUT_MS,
    );
  };

  const combined = anySignal(
    signal,
    stall.signal,
    AbortSignal.timeout(DOWNLOAD_TOTAL_TIMEOUT_MS),
  );

  log(`upgrade: downloading ${url}`);
  resetStall();
  let handle = null;
  try {
    const response = await fetch(url, { signal: combined });
    if (response.status !== 200) {
      throw upgradeError('download', `Download returned HTTP ${response.status}`);
    }

    // A 60-80 MB artifact with no announced size cannot be checked against
    // free space (a real risk on the USB sticks QMail runs from), and the
    // static file server always sends Content-Length — its absence means
    // something is off. Refuse rather than stream blind.
    const total = Number(response.headers.get('content-length')) || 0;
    if (total <= 0) {
      throw upgradeError('download', 'Server did not report a download size');
    }
    const free = await freeBytesIn(path.dirname(stagedPath));
    // 2x: the .new file plus headroom for the filesystem and the moment
    // both old and new launchers exist side by side.
    if (free !== null && free < total * 2) {
      throw upgradeError(
        'no-space',
        `Not enough free space: need ~${Math.ceil((total * 2) / 1e6)} MB`,
      );
    }

    const hash = crypto.createHash('sha256');
    let received = 0;
    handle = await fs.promises.open(stagedPath, 'w');
    for await (const chunk of response.body) {
      combined.throwIfAborted?.();
      resetStall();
      hash.update(chunk);
      await handle.write(chunk);
      received += chunk.length;
      onProgress({ phase: 'downloading', received, total });
    }
    await handle.close();
    handle = null;

    if (received !== total) {
      throw upgradeError(
        'download',
        `Truncated download: got ${received} of ${total} bytes`,
      );
    }
    return hash.digest('hex');
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    if (handle) await handle.close().catch(noop);
  }
}

/** Fresh SHA-256 of a file on disk (re-verification just before the swap). */
async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rename with retries: antivirus scanners take transient locks on freshly
 * written executables, so a first EBUSY/EPERM is not final. Throws the
 * last error if every attempt fails.
 */
async function renameWithRetry(from, to, log) {
  let lastError = null;
  for (const wait of RENAME_RETRY_DELAYS_MS) {
    if (wait) await delay(wait);
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (e) {
      lastError = e;
      log(`upgrade: rename ${path.basename(from)} -> ${path.basename(to)} failed (${e.code}), retrying`);
    }
  }
  throw lastError;
}

// Elevation is for genuinely unwritable locations (Program Files,
// write-protected media). EBUSY is a transient lock — an antivirus scan —
// that the retry loop already waited out; a UAC prompt cannot fix it and
// showing one would mislead the user, so it fails to the manual path.
const isPermissionError = (e) =>
  e && (e.code === 'EPERM' || e.code === 'EACCES');

/**
 * The unelevated swap. On a failure after the first rename, rolls the
 * original launcher back into place (with the same retry the forward
 * renames get — the failure cause is usually a scanner that is still
 * around) before rethrowing. If even the rollback fails, the thrown error
 * carries `stranded: true`: the launcher sits at .old, the new bytes at
 * .new, and the caller must neither elevate (the swap already half
 * happened) nor delete either file.
 */
async function swapInPlace(targetPath, log) {
  const oldPath = targetPath + '.old';
  const stagedPath = targetPath + '.new';

  try {
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  } catch (e) {
    log(`upgrade: could not clear ${oldPath}: ${e.message}`);
  }

  await renameWithRetry(targetPath, oldPath, log);
  try {
    await renameWithRetry(stagedPath, targetPath, log);
  } catch (e) {
    try {
      await renameWithRetry(oldPath, targetPath, log); // roll back
      log('upgrade: second rename failed; original launcher restored');
    } catch (rollbackError) {
      log(`upgrade: ROLLBACK FAILED: ${rollbackError.message}`);
      e.stranded = true;
    }
    throw e;
  }
}

// PowerShell single-quoted literal: only ' needs escaping (doubled).
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** spawn() as a promise resolving to the exit code (null on error/timeout). */
function runProcess(command, args, options) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, options);
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }, 180_000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/**
 * Elevated swap fallback for launchers in unwritable places (Program
 * Files, some USB configurations). Async on purpose: a blocking wait here
 * would freeze the main process for as long as the elevation prompt sits
 * on screen.
 *
 * The elevated commands are built to be safe against every state and
 * every path:
 * - Paths are NEVER interpolated into a shell-parsed string. On Linux
 *   they ride as positional arguments after `sh -c '<fixed script>'`; a
 *   directory named `$(reboot)` is just a directory. On Windows the
 *   script (paths embedded as PowerShell single-quoted literals via
 *   psQuote) is passed base64-as-UTF-16 through -EncodedCommand, which
 *   also survives non-ASCII user paths and leaves no on-disk temp script
 *   for same-user malware to swap under the UAC prompt.
 * - .old is never deleted: when the target is already missing (a partial
 *   unelevated swap got the launcher renamed away), .old IS the original
 *   and the script skips straight to installing .new.
 * - If installing .new fails, the script itself restores .old — only the
 *   elevated context can write that directory.
 *
 * The caller confirms success by re-hashing the target; the exit code
 * (surfaced via -PassThru on Windows) only distinguishes "ran" from
 * "declined/unavailable".
 *
 * @returns {Promise<boolean>} true if the elevated process ran to
 *   completion; false if elevation was declined or unavailable.
 */
async function elevatedSwap(targetPath, log) {
  const oldPath = targetPath + '.old';
  const stagedPath = targetPath + '.new';

  if (process.platform === 'win32') {
    const inner =
      "$ErrorActionPreference='Stop'\n" +
      `$t=${psQuote(targetPath)}; $o=${psQuote(oldPath)}; $s=${psQuote(stagedPath)}\n` +
      'try {\n' +
      '  if (Test-Path -LiteralPath $t) { Move-Item -LiteralPath $t -Destination $o -Force }\n' +
      '  Move-Item -LiteralPath $s -Destination $t -Force\n' +
      '  exit 0\n' +
      '} catch {\n' +
      '  if (-not (Test-Path -LiteralPath $t) -and (Test-Path -LiteralPath $o)) {\n' +
      '    try { Move-Item -LiteralPath $o -Destination $t -Force } catch {}\n' +
      '  }\n' +
      '  exit 1\n' +
      '}\n';
    const encoded = Buffer.from(inner, 'utf16le').toString('base64');
    const outer =
      'try { ' +
      "$p = Start-Process -FilePath 'powershell.exe' -ArgumentList " +
      `'-NoProfile','-WindowStyle','Hidden','-EncodedCommand','${encoded}' ` +
      '-Verb RunAs -Wait -PassThru; exit $p.ExitCode ' +
      '} catch { exit 5 }'; // 5 = UAC declined / failed to launch
    const status = await runProcess(
      'powershell.exe',
      ['-NoProfile', '-Command', outer],
      { windowsHide: true, stdio: 'ignore' },
    );
    if (status !== 0) log(`upgrade: elevated swap exit=${status}`);
    return status === 0;
  }

  if (process.platform === 'linux') {
    const script =
      'o="$1"; t="$2"; s="$3"; ' +
      'if [ -e "$t" ]; then mv -f "$t" "$o" || exit 1; fi; ' +
      'if mv -f "$s" "$t"; then chmod 755 "$t"; ' +
      'else if [ ! -e "$t" ] && [ -e "$o" ]; then mv -f "$o" "$t"; fi; exit 1; fi';
    const status = await runProcess(
      'pkexec',
      ['sh', '-c', script, 'sh', oldPath, targetPath, stagedPath],
      { stdio: 'ignore' },
    );
    if (status === null) log('upgrade: pkexec unavailable');
    return status === 0;
  }

  return false;
}

/**
 * Abort the in-flight download, if any. The staged .new file is deleted
 * by performUpgrade's error path.
 */
function cancelUpgrade() {
  if (activeAbort) {
    activeAbort.abort(upgradeError('cancelled', 'Upgrade cancelled'));
    return true;
  }
  return false;
}

/**
 * The whole pipeline: verify inputs -> fetch SHA256SUMS -> download the
 * canonical launcher (dated-name retry on hash mismatch) -> re-verify ->
 * swap (elevating if needed). Resolves to a result object; never rejects.
 *
 * @param {Object} options
 * @param {string} options.latestVersion  YYYY-MM-DD from checkVersion()
 * @param {(p: Object) => void} [options.onProgress]
 * @param {(msg: string) => void} [options.log]
 * @returns {Promise<{ok: boolean, code?: string, error?: string,
 *                    targetPath?: string}>}
 *   code on failure: 'unsupported' | 'busy' | 'bad-version' | 'not-newer'
 *   | 'sums' | 'no-space' | 'download' | 'hash' | 'permission'
 *   | 'cancelled' | 'swap'
 */
async function performUpgrade({ latestVersion, onProgress = noop, log = noop }) {
  const target = resolveUpgradeTarget();
  if (!target.supported) {
    return { ok: false, code: 'unsupported', error: target.reason };
  }
  if (activeAbort) {
    return { ok: false, code: 'busy', error: 'An upgrade is already running' };
  }

  const version = String(latestVersion || '').trim();
  if (!ISO_DATE_PATTERN.test(version)) {
    return { ok: false, code: 'bad-version', error: `Bad version: ${version}` };
  }
  // Strictly newer only — a stale or replayed version feed must never
  // walk the install backwards to an older, possibly vulnerable build.
  if (!(version > LOCAL_BUILD_DATE)) {
    return {
      ok: false,
      code: 'not-newer',
      error: `${version} is not newer than ${LOCAL_BUILD_DATE}`,
    };
  }

  const { targetPath, platformKey } = target;
  const stagedPath = targetPath + '.new';
  const names = CATALOG[platformKey];
  const controller = new AbortController();
  activeAbort = controller;

  // No 'failed' progress event on purpose: the renderer drives its failure
  // UI solely off this function's return value. A failure event racing the
  // IPC result briefly un-busied the modal and let Upgrade Now be
  // double-clicked (Grok review 2026-08-20).
  const fail = (code, message) => {
    log(`upgrade: FAILED (${code}): ${message}`);
    return { ok: false, code, error: message };
  };

  // The staged download is discarded on failure ONLY while the launcher
  // itself is intact. If the target is gone (a stranded partial swap),
  // .new and .old are the user's only remaining copies — keep both.
  const discardStaged = async () => {
    if (fs.existsSync(targetPath)) {
      await fs.promises.unlink(stagedPath).catch(noop);
    } else {
      log(`upgrade: target missing — keeping ${stagedPath} for recovery`);
    }
  };

  try {
    onProgress({ phase: 'checking' });
    const sums = await fetchSha256Sums(controller.signal);

    // Canonical name first (what use.php links); the immutable dated name
    // is the retry for the one known race — a publish promoting a new
    // canonical between our SHA256SUMS fetch and the download.
    const datedName = names.dated(version);
    const attempts = [];
    if (sums.has(names.canonical)) {
      attempts.push({ name: names.canonical, expected: sums.get(names.canonical) });
    }
    if (sums.has(datedName)) {
      attempts.push({ name: datedName, expected: sums.get(datedName) });
    }
    if (attempts.length === 0) {
      return fail('sums', `SHA256SUMS has no entry for ${names.canonical} or ${datedName}`);
    }

    let verified = false;
    let lastMismatch = null;
    for (const attempt of attempts) {
      const url = DOWNLOAD_BASE_URL + attempt.name;
      const downloadedHash = await downloadTo(url, stagedPath, {
        signal: controller.signal,
        onProgress,
        log,
      });
      if (downloadedHash === attempt.expected) {
        verified = true;
        break;
      }
      lastMismatch = attempt;
      log(
        `upgrade: hash mismatch for ${attempt.name}: expected ${attempt.expected}, got ${downloadedHash}`,
      );
      await fs.promises.unlink(stagedPath).catch(noop);
    }
    if (!verified) {
      return fail(
        'hash',
        `SHA-256 mismatch for ${lastMismatch.name} — download rejected`,
      );
    }

    // Re-verify the staged bytes immediately before the swap: the window
    // between download and install is exactly where on-disk tampering or
    // an overzealous scanner "fixing" the file would land.
    onProgress({ phase: 'verifying' });
    const acceptable = new Set(attempts.map((a) => a.expected));
    const stagedHash = await hashFile(stagedPath);
    if (!acceptable.has(stagedHash)) {
      await fs.promises.unlink(stagedPath).catch(noop);
      return fail('hash', 'Staged file changed between download and install');
    }

    if (process.platform !== 'win32') {
      try {
        await fs.promises.chmod(stagedPath, 0o755);
      } catch (e) {
        // Swapping in a non-executable AppImage would make the relaunch
        // (and every later double-click) fail — stop before the swap.
        await discardStaged();
        return fail('permission', `Could not make the update executable: ${e.message}`);
      }
    }

    onProgress({ phase: 'installing' });
    try {
      await swapInPlace(targetPath, log);
    } catch (e) {
      if (e.stranded || !isPermissionError(e)) {
        // stranded: the launcher is at .old, the update at .new, and even
        // the retried rollback failed — do NOT elevate (the swap already
        // half-happened outside the elevated context's view) and do NOT
        // delete either file. discardStaged() keeps both when the target
        // is missing.
        await discardStaged();
        return fail('swap', e.message);
      }
      log('upgrade: swap needs elevation, prompting');
      const elevated = await elevatedSwap(targetPath, log);
      const installedHash = elevated ? await hashFile(targetPath).catch(() => null) : null;
      if (!elevated || !acceptable.has(installedHash)) {
        await discardStaged();
        return fail('permission', 'The launcher folder is not writable and elevation was declined or failed');
      }
    }

    log(`upgrade: installed ${version} at ${targetPath}`);
    installedAwaitingRestart = true;
    onProgress({ phase: 'ready' });
    return { ok: true, targetPath };
  } catch (e) {
    await discardStaged();
    const code =
      e.upgradeCode ||
      (controller.signal.aborted ? 'cancelled' : 'download');
    return fail(code, e.message || String(e));
  } finally {
    activeAbort = null;
  }
}

module.exports = {
  DOWNLOAD_BASE_URL,
  resolveUpgradeTarget,
  cleanupLeftovers,
  performUpgrade,
  cancelUpgrade,
  consumeInstalledLatch,
  // exported for tests
  parseSha256Sums,
};
