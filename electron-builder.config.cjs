// Build config for electron-builder. We have two output targets:
//
//   en   — English-only. Strips all non-en-US locale .pak files.
//          Outputs release/QMail.exe and is the default for end users.
//   intl — International. Ships all locale .pak files Electron knows
//          about. Outputs release/QMail-intl.exe, ~10–15 MB larger.
//
// Choose with the QMAIL_BUILD env var. package.json scripts set it.

const isIntl = process.env.QMAIL_BUILD === "intl";

const config = {
  appId: "com.qmail.app",
  productName: "QMail",
  directories: {
    output: "release",
  },

  // What goes into the asar. The previous config bundled
  // node_modules/**/* indiscriminately (including devDependencies).
  // electron-builder already cherry-picks production deps; let it.
  //
  // NOTE: this is an explicit ALLOWLIST — electron-builder does NOT walk
  // require()s. Any new top-level module electron.cjs requires MUST be
  // added here, or the packaged app dies at startup with MODULE_NOT_FOUND
  // while the dev run (which reads the source tree) works fine.
  files: [
    "dist/**/*",
    "electron.cjs",
    "preload.cjs",
    "coin-file-state.cjs",
    "transaction-log.cjs",
    "upgrade.cjs",
    "version.json",
  ],

  // Maximum compression — slower packaging, smaller binary. No
  // runtime cost (asar is read in-place).
  compression: "maximum",

  // Strip locales. electron-builder removes the matching .pak files
  // from the packaged Electron runtime. ~10–12 MB saved on the
  // English-only build.
  electronLanguages: isIntl
    ? undefined // all of them
    : ["en-US"],

  // The wordlist ships on every platform. The backend binary is
  // platform-specific (core.exe on Windows, bare `core` ELF on Linux),
  // so it's added per-platform via win.extraResources / linux.extraResources
  // below rather than here — bundling both on every OS would waste ~3 MB
  // and ship a binary that can't run on the target.
  extraResources: [
    {
      from: "public/eff_large_wordlist.txt",
      to: "eff_large_wordlist.txt",
    },
  ],

  portable: {
    // English build: QMail.exe. International: QMail-intl.exe.
    artifactName: isIntl ? "QMail-intl.exe" : "QMail.exe",
  },

  win: {
    target: [
      {
        target: "portable",
        arch: ["x64"],
      },
    ],
    icon: "public/icon.ico",
    extraResources: [
      {
        from: "backend/core.exe",
        to: "backend/core.exe",
      },
    ],
  },

  mac: {
    // DMG: the standard macOS drag-to-Applications installer. arch is
    // taken from the host (Apple Silicon -> arm64) unless overridden on
    // the electron-builder CLI with --arm64 / --x64 / --universal.
    target: [
      {
        target: "dmg",
        arch: [process.arch === "arm64" ? "arm64" : "x64"],
      },
    ],
    artifactName: isIntl ? "QMail-intl.dmg" : "QMail.dmg",
    category: "public.app-category.social-networking",
    icon: "public/icon.icns",
    // Hardened runtime + entitlements are required for Apple notarization.
    // They are harmless on an unsigned/ad-hoc local build (electron-builder
    // skips signing when no identity is available) and mean a real
    // Developer ID build "just works" once a cert is provided — see below.
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    // The bundled `core` backend is a Mach-O that we ship ALREADY universal
    // (arm64 + x86_64). @electron/universal's merge step otherwise aborts on
    // a Mach-O that is byte-identical across the two arch builds; this rule
    // tells it that file is expected and should be taken as-is.
    x64ArchFiles: "**/backend/core",
    // The backend binary is a bare `core` Mach-O, same as Linux. Ship it
    // under resources/backend where electron.cjs looks (process.resourcesPath).
    // It is shipped universal (arm64 + x86_64) so the app runs natively on
    // both Apple Silicon and Intel Macs.
    extraResources: [
      {
        from: "backend/core",
        to: "backend/core",
      },
    ],
  },

  linux: {
    // AppImage: a single self-contained executable file, the Linux
    // analogue of the portable Windows .exe — no install step, runs
    // from anywhere including a USB stick.
    target: [
      {
        target: "AppImage",
        arch: ["x64"],
      },
    ],
    artifactName: isIntl ? "QMail-intl.AppImage" : "QMail.AppImage",
    category: "Network",
    icon: "public/icon.png",
    extraResources: [
      {
        from: "backend/core",
        to: "backend/core",
      },
    ],
  },
};

module.exports = config;
