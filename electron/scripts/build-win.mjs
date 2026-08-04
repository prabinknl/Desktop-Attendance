/**
 * Runs electron-builder. Prefers the project `release/` folder so installers
 * stay next to the repo. Falls back to %LOCALAPPDATA%\AttendanceDesktop\release
 * when OneDrive locks the project folder (EPERM/EBUSY on win-unpacked).
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const args = process.argv.slice(2);
const dirMode = args.includes('--dir');

const preferredOut = path.join(root, 'release');
const fallbackOut = path.join(os.homedir(), 'AppData', 'Local', 'AttendanceDesktop', 'release');

function canWrite(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function tryCleanWinUnpacked(dir) {
  for (const name of ['win-unpacked', 'win-unpacked.tmp']) {
    const target = path.join(dir, name);
    if (!fs.existsSync(target)) continue;
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      return false;
    }
  }
  return true;
}

let outDir = canWrite(preferredOut) ? preferredOut : fallbackOut;
fs.mkdirSync(outDir, { recursive: true });

if (outDir === preferredOut && !tryCleanWinUnpacked(outDir)) {
  console.warn(
    '[electron:build-win] release/win-unpacked is locked (OneDrive/AV); using LocalAppData fallback',
  );
  outDir = fallbackOut;
  fs.mkdirSync(outDir, { recursive: true });
  tryCleanWinUnpacked(outDir);
} else if (outDir === fallbackOut) {
  tryCleanWinUnpacked(outDir);
}

console.log(`[electron:build-win] output -> ${outDir}`);

const builderArgs = ['--win', `--config.directories.output=${outDir}`];
if (dirMode) builderArgs.unshift('--dir');

// Run electron-builder via node + cli.js so paths with spaces work on Windows
// (npx.cmd + shell:true splits "App Dev\\Attendance desktop\\release";
//  spawning .cmd with shell:false raises EINVAL).
const builderCli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
if (!fs.existsSync(builderCli)) {
  console.error(`[electron:build-win] Missing ${builderCli}. Run npm install.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [builderCli, ...builderArgs], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error('[electron:build-win] Failed to start electron-builder:', result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const packagedExpress = path.join(
  outDir,
  'win-unpacked',
  'resources',
  'server',
  'node_modules',
  'express',
  'package.json',
);
if (!fs.existsSync(packagedExpress)) {
  console.error(
    `[electron:build-win] Packaged API missing express at ${packagedExpress}. afterPack failed.`,
  );
  process.exit(1);
}

console.log(`[electron:build-win] Done. Installer folder: ${outDir}`);
console.log('[electron:build-win] Packaged express: OK');
