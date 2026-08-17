/**
 * Runs electron-builder with an output directory outside OneDrive when possible.
 * OneDrive often fails electron-builder's rename of win-unpacked.tmp (EPERM).
 * Final installer / portable artifacts are always copied into ./release as well.
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const projectRelease = path.join(root, 'release');

const args = process.argv.slice(2);
const dirMode = args.includes('--dir');

const preferredOut = path.join(os.homedir(), 'AppData', 'Local', 'AttendanceDesktop', 'release');
const fallbackOut = projectRelease;

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
fs.mkdirSync(projectRelease, { recursive: true });

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

/** Copy finished installers/portable exes into the project release/ folder. */
function mirrorArtifacts(fromDir, toDir) {
  if (path.resolve(fromDir) === path.resolve(toDir)) return;
  fs.mkdirSync(toDir, { recursive: true });
  for (const name of fs.readdirSync(fromDir)) {
    // Only mirror current product artifacts (avoid copying leftover old builds).
    if (!name.startsWith('Attendance Desktop')) continue;
    const src = path.join(fromDir, name);
    if (!fs.statSync(src).isFile()) continue;
    const dest = path.join(toDir, name);
    try {
      fs.copyFileSync(src, dest);
      console.log(`[electron:build-win] Copied ${name} -> release/`);
    } catch (err) {
      console.warn(`[electron:build-win] Could not copy ${name}:`, err.message);
    }
  }
}

mirrorArtifacts(outDir, projectRelease);

console.log(`[electron:build-win] Done.`);
console.log(`[electron:build-win] Builder output: ${outDir}`);
console.log(`[electron:build-win] Project release: ${projectRelease}`);
