// ===========================================================================
//  PLATFORM KEY  —  which build of QMail is this?
// ===========================================================================
//
//  The remote version manifest publishes one release date per platform, so
//  the client has to say which platform it is before it can ask "is there
//  a newer me?". This module answers that with a single lowercase key that
//  matches a top-level field in the manifest (see PLATFORM_KEYS below).
//
//  WHY NOT process.platform: checkVersion() runs in the renderer, where
//  process is not exposed (contextIsolation). Rather than add an IPC round
//  trip to a check that already fans out to seven mirrors, we read the user
//  agent — Electron always sets a Chrome UA carrying the host OS, and the
//  packaged app is the only way this code ships.
//
//  WHY THE LINUX KEY IS JUST "linux-app": electron-builder.config.cjs
//  currently produces exactly two artifacts — a Windows `portable` .exe and
//  a Linux AppImage. A running process cannot tell an AppImage from a .deb
//  install (both are plain `linux`), so if .deb/.tar.gz targets are ever
//  added, the packaging format must be stamped into version.json at build
//  time and read here instead of guessed. Until those targets exist there
//  is nothing to disambiguate, and guessing would be inventing a
//  distinction the build doesn't make.
//
// ===========================================================================

// Every key the manifest may carry. The client only ever looks up its own,
// but the full list documents the contract and is used by the tests to
// guard against typos drifting between client and server.
export const PLATFORM_KEYS = Object.freeze([
  "windows",
  "linux-app",
  "linux-deb",
  "linux-tar-gz",
  "mac",
  "android",
  "iphone",
  "core",
]);

/**
 * Resolves the manifest key for the running build.
 *
 * @param {string} [userAgent] Override for testing.
 * @returns {string|null} A key from PLATFORM_KEYS, or null when the host OS
 *   can't be identified — callers must treat null as "don't know", never as
 *   "no update", so an unrecognized platform degrades to the legacy
 *   date-only check rather than silently claiming to be current.
 */
export const detectPlatformKey = (userAgent = undefined) => {
  const ua =
    userAgent ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "") ??
    "";
  const value = String(ua).toLowerCase();
  if (!value) return null;

  // Order matters: "android" contains "linux" in every real UA string, and
  // iPadOS reports "mac os x", so the mobile checks must come first.
  if (value.includes("android")) return "android";
  if (/(iphone|ipad|ipod)/.test(value)) return "iphone";
  if (value.includes("win")) return "windows";
  if (value.includes("mac")) return "mac";
  if (value.includes("linux") || value.includes("x11")) return "linux-app";
  return null;
};
