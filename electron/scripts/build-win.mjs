/**
 * Runs electron-builder with an output directory outside OneDrive when possible.
 * OneDrive often fails electron-builder's rename of win-unpacked.tmp (EPERM).
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

const preferredOut = path.join(os.homedir(), 'AppData', 'Local', 'AttendanceDesktop', 'release');
const fallbackOut = path.join(root, 'release');

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

const outDir = canWrite(preferredOut) ? preferredOut : fallbackOut;
fs.mkdirSync(outDir, { recursive: true });

// Clean previous unpack target to avoid rename conflicts
for (const name of ['win-unpacked', 'win-unpacked.tmp']) {
  const target = path.join(outDir, name);
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(`[electron:build-win] output -> ${outDir}`);

const builderArgs = [
  'electron-builder',
  '--win',
  `--config.directories.output=${outDir}`,
];
if (dirMode) builderArgs.splice(2, 0, '--dir');

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  builderArgs,
  {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`[electron:build-win] Done. Installer folder: ${outDir}`);
