/**
 * After electron-builder succeeds, copy the versioned Windows installer to a
 * stable filename for website downloads:
 *   Attendance.Desktop.Setup.<version>.exe  →  Attendance-Desktop-Setup.exe
 *
 * Does not rename the versioned installer or edit latest.yml (electron-updater).
 *
 * Usage:
 *   node scripts/create-stable-installer.cjs [releaseDir]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pkg = require(pkgPath);
const version = typeof pkg.version === 'string' ? pkg.version.trim() : '';
const releaseDir = path.resolve(process.argv[2] || path.join(root, 'release'));
const STABLE_NAME = 'Attendance-Desktop-Setup.exe';
const versionedName = `Attendance.Desktop.Setup.${version}.exe`;
const src = path.join(releaseDir, versionedName);
const dest = path.join(releaseDir, STABLE_NAME);

function listReleaseDir() {
  try {
    return fs
      .readdirSync(releaseDir)
      .map((name) => `  ${name}`)
      .join('\n');
  } catch (err) {
    return `  (could not list directory: ${err.message})`;
  }
}

if (!version) {
  console.error('[create-stable-installer] package.json is missing a version field.');
  process.exit(1);
}

if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
  console.error(
    [
      '[create-stable-installer] Could not find the versioned Windows installer.',
      `  Expected: ${src}`,
      `  Version:  ${version} (from package.json)`,
      '',
      `Files in ${releaseDir}:`,
      listReleaseDir(),
      '',
      'This script must run after electron-builder finishes successfully.',
      'Do not rename the versioned installer; electron-updater needs it.',
    ].join('\n'),
  );
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log(`[create-stable-installer] Copied ${versionedName} → ${STABLE_NAME}`);
console.log(`[create-stable-installer] ${dest}`);
