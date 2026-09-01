/**
 * Stages a production copy of the Express API for electron-builder extraResources.
 * Secrets (.env) are intentionally NOT copied into the installer.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const require = createRequire(import.meta.url);
const { copyDir, assertCopied, assertServerDist } = require('./copy-tree.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const serverSrc = path.join(root, 'server');
const outDir = path.join(root, 'electron-resources', 'server');
const distSrc = path.join(serverSrc, 'dist');

if (!fs.existsSync(path.join(distSrc, 'index.js'))) {
  console.error('[prepare-server-resources] server/dist missing. Run npm run build:server first.');
  process.exit(1);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function rmWithRetry(target, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      sleep(1000 * (i + 1));
    }
  }
}

rmWithRetry(outDir);
fs.mkdirSync(outDir, { recursive: true });

assertServerDist(distSrc, 'prepare-server-resources source');
const distDest = path.join(outDir, 'dist');
console.log(`[prepare-server-resources] Copying ${distSrc} -> ${distDest}`);
copyDir(distSrc, distDest, { skipTests: true });
assertCopied(distSrc, distDest, 'prepare-server-resources dist', { skipTests: true });
assertServerDist(distDest, 'prepare-server-resources staged');
fs.copyFileSync(path.join(serverSrc, 'package.json'), path.join(outDir, 'package.json'));
if (fs.existsSync(path.join(serverSrc, '.env.example'))) {
  fs.copyFileSync(path.join(serverSrc, '.env.example'), path.join(outDir, '.env.example'));
}

// Packaged Electron MUST use dist-electron/ which is built with the correct
// API URL configuration (relative /api for local backend, not production API).
// dist/ is for the published website and uses different Vite config.
const electronDistPath = path.join(root, 'dist-electron');
const webDistPath = path.join(root, 'dist');

let clientDistSrc = null;
if (fs.existsSync(path.join(electronDistPath, 'index.html'))) {
  clientDistSrc = electronDistPath;
} else if (fs.existsSync(path.join(webDistPath, 'index.html'))) {
  clientDistSrc = webDistPath;
  console.warn('[prepare-server-resources] WARNING: Using dist/ (web build). For Electron packaging,');
  console.warn('[prepare-server-resources] dist-electron/ should be built first (npm run build:electron-ui)');
  console.warn('[prepare-server-resources] This may cause API URL misconfigurations in the packaged app.');
}

if (clientDistSrc) {
  console.log(`[prepare-server-resources] Copying frontend UI from: ${clientDistSrc}`);
  const publicDest = path.join(outDir, 'public');
  copyDir(clientDistSrc, publicDest);
  assertCopied(clientDistSrc, publicDest, 'prepare-server-resources public');
} else {
  console.error('[prepare-server-resources] FATAL: No frontend build found.');
  console.error(`[prepare-server-resources] Expected: ${electronDistPath}/index.html`);
  console.error(`[prepare-server-resources] Or: ${webDistPath}/index.html`);
  console.error('[prepare-server-resources] Run: npm run build:electron-ui');
  process.exit(1);
}

console.log('[prepare-server-resources] Installing production server dependencies...');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCmd, ['install', '--omit=dev', '--no-fund', '--no-audit'], {
  cwd: outDir,
  stdio: 'inherit',
  shell: true,
});

if (result.status !== 0) {
  console.error('[prepare-server-resources] npm install failed');
  process.exit(result.status ?? 1);
}

const expressPkg = path.join(outDir, 'node_modules', 'express', 'package.json');
if (!fs.existsSync(expressPkg)) {
  console.error(`[prepare-server-resources] express missing after npm install: ${expressPkg}`);
  process.exit(1);
}

console.log(`[prepare-server-resources] Ready at ${outDir}`);
console.log('[prepare-server-resources] express: OK');
