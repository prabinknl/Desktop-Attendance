/**
 * Stages a production copy of the Express API for electron-builder extraResources.
 * Secrets (.env) are intentionally NOT copied into the installer.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

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

function copyDirRobust(src, dest) {
  // Prefer recursive Node copy with skips for OneDrive conflict copies.
  // Avoids robocopy hanging forever on cloud-placeholder conflict files.
  const skipName = (name) =>
    /-DESKTOP-[A-Z0-9]+\./i.test(name) ||
    /conflict/i.test(name);

  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (skipName(entry.name)) {
        console.warn(`[prepare-server-resources] Skipping ${entry.name}`);
        continue;
      }
      const fromPath = path.join(from, entry.name);
      const toPath = path.join(to, entry.name);
      if (entry.isDirectory()) {
        walk(fromPath, toPath);
      } else if (entry.isFile()) {
        let lastErr;
        for (let i = 0; i < 4; i++) {
          try {
            fs.copyFileSync(fromPath, toPath);
            lastErr = undefined;
            break;
          } catch (err) {
            lastErr = err;
            sleep(500 * (i + 1));
          }
        }
        if (lastErr) throw lastErr;
      }
    }
  };

  walk(src, dest);
}

rmWithRetry(outDir);
fs.mkdirSync(outDir, { recursive: true });

console.log(`[prepare-server-resources] Copying ${distSrc} -> ${path.join(outDir, 'dist')}`);
copyDirRobust(distSrc, path.join(outDir, 'dist'));
fs.copyFileSync(path.join(serverSrc, 'package.json'), path.join(outDir, 'package.json'));
if (fs.existsSync(path.join(serverSrc, '.env.example'))) {
  fs.copyFileSync(path.join(serverSrc, '.env.example'), path.join(outDir, '.env.example'));
}

const clientDistCandidates = [
  path.join(root, 'dist-electron'),
  path.join(root, 'dist'),
];
let clientDistSrc = null;
for (const cand of clientDistCandidates) {
  if (fs.existsSync(path.join(cand, 'index.html'))) {
    clientDistSrc = cand;
    break;
  }
}

if (clientDistSrc) {
  console.log(`[prepare-server-resources] Copying frontend UI ${clientDistSrc} -> ${path.join(outDir, 'public')}`);
  copyDirRobust(clientDistSrc, path.join(outDir, 'public'));
} else {
  console.warn('[prepare-server-resources] Warning: No frontend build found (dist-electron or dist).');
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
