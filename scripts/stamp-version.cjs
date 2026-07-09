// Stamps version.json before every build (wired up as the npm "prebuild"
// hook, so it runs automatically ahead of `vite build` and therefore ahead
// of every electron-builder packaging script).
//
// version.json is the single source of truth for the client version:
//   buildDate   — "YYYY-MM-DD", set to the day of the build. Compared as a
//                 plain string against the remote qmail_client_version files
//                 to decide whether an update is available (see
//                 src/api/qmailApiServices.js checkVersion()).
//   buildNumber — monotonically increasing counter, bumped on every build.
//                 Display-only; distinguishes same-day builds.
//
// Consumed by src/version.js (renderer, via Vite JSON import) and
// electron.cjs (main process, via require). package.json "version" is
// derived here as 1.0.<buildNumber> so the .exe file metadata tracks it.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const versionFile = path.join(root, 'version.json');
const packageFile = path.join(root, 'package.json');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const buildDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

let previous = { buildDate: '', buildNumber: 0 };
try {
  previous = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
} catch {
  // Missing or corrupt version.json — start the counter over.
}

const stamped = {
  buildDate,
  buildNumber: (Number(previous.buildNumber) || 0) + 1,
};
fs.writeFileSync(versionFile, `${JSON.stringify(stamped, null, 2)}\n`);

const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
pkg.version = `1.0.${stamped.buildNumber}`;
fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);

process.stdout.write(
  `[stamp-version] ${stamped.buildDate} build ${stamped.buildNumber} (package.json version ${pkg.version})\n`,
);
