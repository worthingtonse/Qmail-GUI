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
  files: [
    "dist/**/*",
    "electron.cjs",
    "preload.cjs",
    "coin-file-state.cjs",
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
