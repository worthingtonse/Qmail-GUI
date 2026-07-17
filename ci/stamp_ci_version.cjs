#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const versionFile = path.join(root, 'version.json');
const packageFile = path.join(root, 'package.json');

const iid = Number(process.env.CI_PIPELINE_IID);
if (!Number.isInteger(iid) || iid <= 0) {
  process.stderr.write('CI_PIPELINE_IID must be a positive integer\n');
  process.exit(2);
}

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const version = {
  buildDate: `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`,
  buildNumber: iid,
};
fs.writeFileSync(versionFile, `${JSON.stringify(version, null, 2)}\n`);

const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
pkg.version = `1.0.${iid}`;
fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);

fs.mkdirSync(path.join(root, 'ci-build'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'ci-build', 'version.env'),
  `QMAIL_BUILD_DATE=${version.buildDate}\nQMAIL_BUILD_NUMBER=${version.buildNumber}\n`,
);

process.stdout.write(
  `[stamp-ci-version] ${version.buildDate} build ${version.buildNumber} (package.json version ${pkg.version})\n`,
);
