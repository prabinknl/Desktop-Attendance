/**
 * Builds the Vite frontend for Electron, verifies output, then runs electron-builder.
 * Usage: node electron/build-desktop.mjs [--dir]
 *   --dir  → unpacked app only (desktop:pack)
 *   default → Windows NSIS installer (desktop:build)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distIndex = path.join(root, 'dist', 'index.html');
const packDirOnly = process.argv.includes('--dir');

function resolveBin(pkg, ...segments) {
  const pkgJson = require.resolve(`${pkg}/package.json`);
  return path.join(path.dirname(pkgJson), ...segments);
}

function runNode(scriptPath, args, label) {
  console.log(`\n[desktop] ${label}…`);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if ((result.status ?? 1) !== 0) {
    console.error(`[desktop] ${label} failed (exit ${result.status ?? 1}).`);
    process.exit(result.status ?? 1);
  }
}

// Do NOT set VITE_API_BASE_URL here. Desktop production serves dist over
// localhost and proxies /api, so the default relative `/api` must stay.
console.log(
  '[desktop] Frontend env for this build: VITE_API_BASE_URL is unset → API calls use `/api` (Electron local proxy).',
);

runNode(resolveBin('typescript', 'bin', 'tsc'), ['-b'], 'Typecheck / project references');
runNode(resolveBin('vite', 'bin', 'vite.js'), ['build', '--base', './'], 'Vite production build (base=./)');

if (!fs.existsSync(distIndex)) {
  console.error(`[desktop] Missing production build files: ${distIndex}`);
  console.error('[desktop] Aborting electron-builder.');
  process.exit(1);
}

const builderCli = resolveBin('electron-builder', 'cli.js');
const builderArgs = packDirOnly ? ['--dir', '--win'] : ['--win', 'nsis'];
runNode(builderCli, builderArgs, packDirOnly ? 'electron-builder pack' : 'electron-builder NSIS');

const releaseDir = path.join(root, 'release');
console.log(`\n[desktop] Done. Output folder: ${releaseDir}`);
