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

  extraResources: [
    {
      from: "public/eff_large_wordlist.txt",
      to: "eff_large_wordlist.txt",
    },
    {
      from: "backend/core.exe",
      to: "backend/core.exe",
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
  },
};

module.exports = config;
