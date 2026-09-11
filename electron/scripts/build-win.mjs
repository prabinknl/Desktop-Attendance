/**
 * Runs electron-builder. Prefers the project `release/` folder so installers
 * stay next to the repo. Falls back to %LOCALAPPDATA%\AttendanceDesktop\release
 * (or C:\temp) when OneDrive locks the project folder (EPERM/EBUSY on win-unpacked).
 * Always copies installer artifacts back into the project `release/` folder.
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
const publishIdx = args.indexOf('--publish');
let publishMode = 'never';
if (publishIdx !== -1) {
  const next = args[publishIdx + 1];
  publishMode = next && !next.startsWith('-') ? next : 'always';
}

const preferredOut = path.join(root, 'release');
const fallbackOut = path.join(process.env.LOCALAPPDATA || 'C:\\temp', 'AttendanceDesktop', 'release');

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

function tryKillStaleProcesses() {
  if (process.platform !== 'win32') return;
  for (const image of ['Attendance Desktop.exe', 'Attendance App.exe', 'Attendance.exe']) {
    try {
      spawnSync('taskkill', ['/F', '/IM', image], { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  }
}

function tryCleanWinUnpacked(dir) {
  for (const name of ['win-unpacked', 'win-unpacked.tmp']) {
    const target = path.join(dir, name);
    if (!fs.existsSync(target)) continue;
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch {
      if (process.platform === 'win32') {
        spawnSync('cmd.exe', ['/c', 'rmdir', '/s', '/q', `"${target}"`], { stdio: 'ignore' });
      }
    }
    if (fs.existsSync(target)) return false;
  }
  return true;
}

function copyInstallerArtifacts(fromDir, toDir) {
  fs.mkdirSync(toDir, { recursive: true });
  const wanted = new Set([
    'latest.yml',
    'builder-debug.yml',
    'builder-effective-config.yaml',
  ]);
  let copied = 0;
  for (const item of fs.readdirSync(fromDir)) {
    if (item === 'win-unpacked' || item === 'win-unpacked.tmp') continue;
    const src = path.join(fromDir, item);
    if (!fs.statSync(src).isFile()) continue;
    const isInstaller =
      /^Attendance[-.]Desktop[-.]Setup/i.test(item) ||
      item.endsWith('.blockmap') ||
      wanted.has(item) ||
      item === 'Attendance-Desktop-Setup.exe';
    if (!isInstaller) continue;
    fs.copyFileSync(src, path.join(toDir, item));
    copied += 1;
  }
  return copied;
}

tryKillStaleProcesses();

const isOneDrive = /onedrive/i.test(root);
let outDir = preferredOut;

if (!canWrite(preferredOut)) {
  outDir = fallbackOut;
  console.warn(
    `[electron:build-win] Project release/ is not writable; using fallback: ${outDir}`,
  );
} else if (isOneDrive) {
  // Prefer project release/ when writable so the folder is not left empty.
  // Fall back only if win-unpacked cleanup fails (common OneDrive lock).
  console.log(
    '[electron:build-win] Project is under OneDrive; using release/ while writable.',
  );
}

fs.mkdirSync(outDir, { recursive: true });

if (!tryCleanWinUnpacked(outDir)) {
  tryKillStaleProcesses();
  spawnSync('powershell.exe', ['-Command', 'Start-Sleep -Milliseconds 1000'], { stdio: 'ignore' });
  if (!tryCleanWinUnpacked(outDir)) {
    if (outDir === preferredOut) {
      outDir = fallbackOut;
      fs.mkdirSync(outDir, { recursive: true });
      console.warn(
        `[electron:build-win] win-unpacked locked under OneDrive; using fallback: ${outDir}`,
      );
      if (!tryCleanWinUnpacked(outDir)) {
        outDir = path.join(os.tmpdir(), `AttendanceDesktop-build-${Date.now()}`);
        fs.mkdirSync(outDir, { recursive: true });
        console.warn(`[electron:build-win] Using clean temp target: ${outDir}`);
      }
    } else {
      outDir = path.join(os.tmpdir(), `AttendanceDesktop-build-${Date.now()}`);
      fs.mkdirSync(outDir, { recursive: true });
      console.warn(`[electron:build-win] Using clean temp target: ${outDir}`);
    }
  }
}

console.log(`[electron:build-win] output -> ${outDir}`);

// Keep package.json artifactName (Attendance.Desktop.Setup.${version}.${ext}) so
// electron-updater latest.yml continues to reference the versioned installer.
// Desktop/Start Menu shortcut name includes version via nsis.shortcutName
// ("Attendance Desktop v${version}" in package.json).
const builderArgs = ['--win', '--x64', `--config.directories.output=${outDir}`];
if (dirMode) builderArgs.unshift('--dir');
else builderArgs.push(`--publish=${publishMode}`);

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

const packagedDeviceRoutes = path.join(
  outDir,
  'win-unpacked',
  'resources',
  'server',
  'dist',
  'routes',
  'deviceRoutes.js',
);
if (!fs.existsSync(packagedDeviceRoutes)) {
  console.error(
    `[electron:build-win] Packaged API missing ${packagedDeviceRoutes}. afterPack skipped OneDrive placeholders or dist is incomplete.`,
  );
  process.exit(1);
}

// Stable website filename: copy versioned NSIS installer after a successful build.
// Skipped for --dir (unpacked) builds. Does not rename updater artifacts.
if (!dirMode) {
  const copyScript = path.join(root, 'scripts', 'create-stable-installer.cjs');
  const copyResult = spawnSync(process.execPath, [copyScript, outDir], {
    cwd: root,
    stdio: 'inherit',
  });
  if (copyResult.error) {
    console.error('[electron:build-win] Failed to start create-stable-installer:', copyResult.error.message);
    process.exit(1);
  }
  if (copyResult.status !== 0) {
    process.exit(copyResult.status ?? 1);
  }
}

// Always mirror installer artifacts into the project release/ folder.
if (outDir !== preferredOut) {
  try {
    const n = copyInstallerArtifacts(outDir, preferredOut);
    console.log(
      `[electron:build-win] Copied ${n} installer artifact(s) to ${preferredOut}`,
    );
  } catch (err) {
    console.warn(
      `[electron:build-win] Could not copy installer to project release folder: ${err.message}`,
    );
    console.warn(`[electron:build-win] Artifacts remain at: ${outDir}`);
  }
}

console.log(`[electron:build-win] Done. Installer folder: ${outDir}`);
console.log('[electron:build-win] Packaged express: OK');
