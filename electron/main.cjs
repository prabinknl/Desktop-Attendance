/**
 * Electron main process for Attendance.
 * Dev: loads Vite at http://127.0.0.1:3002 (API via Vite proxy or local spawn).
 * Prod: loads Express API at http://127.0.0.1:3001 (which serves both the
 * frontend UI and the /api backend on a single port).
 */
'use strict';

const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn, execFile } = require('child_process');

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_DEV_URL || 'http://127.0.0.1:3002';
const DEFAULT_API_PORT = 3001;
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_INTERVAL_MS = 400;

/** Optional override — when unset, desktop always uses the local Express API. */
const API_TARGET_OVERRIDE = (process.env.ELECTRON_API_TARGET || '').replace(/\/$/, '');

let mainWindow = null;
/** @type {import('child_process').ChildProcess | null} */
let apiProcess = null;
let apiPort = DEFAULT_API_PORT;
let apiStartedByUs = false;
let isQuitting = false;
/** @type {number | null} */
let apiExitCode = null;
/** @type {string | null} */
let apiExitSignal = null;
/** @type {fs.WriteStream | null} */
let apiLogStream = null;

function getLogsDir() {
  return path.join(app.getPath('userData'), 'logs');
}

function ensureLogsDir() {
  const dir = getLogsDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

function getApiLogPath() {
  return path.join(ensureLogsDir(), 'api-startup.log');
}

function appendStartupLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(getApiLogPath(), line, 'utf8');
  } catch {
    /* ignore */
  }
  console.log(message);
}

function openApiLogStream() {
  try {
    apiLogStream = fs.createWriteStream(getApiLogPath(), { flags: 'a' });
    apiLogStream.write(`\n===== API session ${new Date().toISOString()} =====\n`);
  } catch (err) {
    apiLogStream = null;
    console.warn('[Electron] Could not open API log stream:', err.message);
  }
}

function writeApiLog(chunk, streamLabel) {
  const text = String(chunk);
  if (apiLogStream) {
    try {
      apiLogStream.write(`[${streamLabel}] ${text}`);
      if (!text.endsWith('\n')) apiLogStream.write('\n');
    } catch {
      /* ignore */
    }
  }
}

function closeApiLogStream() {
  if (!apiLogStream) return;
  try {
    apiLogStream.end();
  } catch {
    /* ignore */
  }
  apiLogStream = null;
}

function getLocalApiOrigin() {
  return `http://127.0.0.1:${apiPort}`;
}



function getUserServerEnvPath() {
  return path.join(app.getPath('userData'), 'server.env');
}

function getDesktopDataDir() {
  return path.join(app.getPath('userData'), 'data');
}

function resolveEnvFilePaths() {
  const candidates = [];
  candidates.push(getUserServerEnvPath());
  if (!isDev) {
    candidates.push(path.join(process.resourcesPath, 'server', '.env'));
  }
  candidates.push(path.join(__dirname, '..', 'server', '.env'));
  candidates.push(path.join(__dirname, '..', '.env'));
  return candidates;
}

function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function generateEncryptionKey() {
  return require('crypto').randomBytes(32).toString('hex');
}

/**
 * First launch of the installed app: create %APPDATA%/<name>/server.env so the
 * local API can encrypt device passwords and reach the LAN Hikvision machine.
 */
function ensureDesktopServerEnv() {
  const userEnvPath = getUserServerEnvPath();
  if (fs.existsSync(userEnvPath)) return userEnvPath;

  const exampleCandidates = [];
  if (!isDev) {
    exampleCandidates.push(path.join(process.resourcesPath, 'server', '.env.example'));
  }
  exampleCandidates.push(path.join(__dirname, '..', 'server', '.env.example'));
  const devEnvPath = path.join(__dirname, '..', 'server', '.env');

  let seedText = '';
  if (fs.existsSync(devEnvPath)) {
    try {
      seedText = fs.readFileSync(devEnvPath, 'utf8');
      appendStartupLog(`[Electron] Seeding desktop server.env from ${devEnvPath}`);
    } catch {
      seedText = '';
    }
  }
  if (!seedText) {
    for (const examplePath of exampleCandidates) {
      if (!fs.existsSync(examplePath)) continue;
      try {
        seedText = fs.readFileSync(examplePath, 'utf8');
        appendStartupLog(`[Electron] Seeding desktop server.env from ${examplePath}`);
        break;
      } catch {
        /* try next */
      }
    }
  }

  const parsed = seedText ? parseEnvFile(seedText) : {};
  if (!parsed.ENCRYPTION_KEY || parsed.ENCRYPTION_KEY.length !== 64) {
    parsed.ENCRYPTION_KEY = generateEncryptionKey();
  }
  parsed.DEVICE_SYNC_ENABLED = 'true';
  if (!parsed.DATABASE_URL) {
    parsed.USE_MEMORY_STORE = 'true';
  }

  const lines = [
    '# Auto-created by Attendance desktop on first launch.',
    '# Edit this file or replace it with your server/.env to share the same database.',
    `# Path: ${userEnvPath}`,
    '',
    `DEVICE_SYNC_ENABLED=${parsed.DEVICE_SYNC_ENABLED}`,
    `ENCRYPTION_KEY=${parsed.ENCRYPTION_KEY}`,
  ];
  if (parsed.DATABASE_URL) lines.push(`DATABASE_URL=${parsed.DATABASE_URL}`);
  if (parsed.USE_MEMORY_STORE) lines.push(`USE_MEMORY_STORE=${parsed.USE_MEMORY_STORE}`);
  if (parsed.INSFORGE_BASE_URL) lines.push(`INSFORGE_BASE_URL=${parsed.INSFORGE_BASE_URL}`);
  if (parsed.INSFORGE_API_KEY) lines.push(`INSFORGE_API_KEY=${parsed.INSFORGE_API_KEY}`);
  if (parsed.ADMIN_SIGNUP_EMAIL) lines.push(`ADMIN_SIGNUP_EMAIL=${parsed.ADMIN_SIGNUP_EMAIL}`);
  if (parsed.APP_PUBLIC_URL) lines.push(`APP_PUBLIC_URL=${parsed.APP_PUBLIC_URL}`);
  if (parsed.CORS_ORIGINS) lines.push(`CORS_ORIGINS=${parsed.CORS_ORIGINS}`);

  try {
    fs.mkdirSync(path.dirname(userEnvPath), { recursive: true });
    fs.writeFileSync(userEnvPath, `${lines.join('\n')}\n`, 'utf8');
    appendStartupLog(`[Electron] Created ${userEnvPath}`);
  } catch (err) {
    console.warn('[Electron] Could not create server.env:', err.message);
  }
  return userEnvPath;
}

function loadDesktopEnv() {
  ensureDesktopServerEnv();

  const dataDir = getDesktopDataDir();
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch {
    /* ignore */
  }

  const env = {
    ...process.env,
    ELECTRON_DESKTOP: '1',
    DEVICE_SYNC_ENABLED: process.env.DEVICE_SYNC_ENABLED ?? 'true',
    PORT: String(apiPort),
    HOST: '127.0.0.1',
    CORS_ORIGINS: process.env.CORS_ORIGINS ?? '*',
    ATTENDANCE_DATA_DIR: dataDir,
    NODE_ENV: 'production',
  };

  for (const filePath of resolveEnvFilePaths()) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = parseEnvFile(fs.readFileSync(filePath, 'utf8'));
      for (const [key, value] of Object.entries(parsed)) {
        if (
          key === 'PORT' ||
          key === 'HOST' ||
          key === 'ELECTRON_DESKTOP' ||
          key === 'ATTENDANCE_DATA_DIR'
        ) {
          continue;
        }
        env[key] = value;
      }
      appendStartupLog(`[Electron] Loaded server env from ${filePath}`);
      break;
    } catch (err) {
      console.warn(`[Electron] Failed reading ${filePath}:`, err.message);
    }
  }

  env.PORT = String(apiPort);
  env.HOST = '127.0.0.1';
  env.ELECTRON_DESKTOP = '1';
  env.ATTENDANCE_DATA_DIR = dataDir;
  if (!env.DEVICE_SYNC_ENABLED) env.DEVICE_SYNC_ENABLED = 'true';
  if (!env.CORS_ORIGINS) env.CORS_ORIGINS = '*';
  if (!env.ENCRYPTION_KEY || String(env.ENCRYPTION_KEY).length !== 64) {
    env.ENCRYPTION_KEY = generateEncryptionKey();
    appendStartupLog('[Electron] Generated ephemeral ENCRYPTION_KEY (server.env was incomplete)');
  }
  return env;
}

function resolveServerEntry() {
  if (isDev) {
    const compiled = path.join(__dirname, '..', 'server', 'dist', 'index.js');
    if (fs.existsSync(compiled)) {
      return { entry: compiled, useTsx: false, cwd: path.join(__dirname, '..', 'server') };
    }
    return {
      entry: path.join(__dirname, '..', 'server', 'src', 'index.ts'),
      useTsx: true,
      cwd: path.join(__dirname, '..'),
    };
  }
  return {
    entry: path.join(process.resourcesPath, 'server', 'dist', 'index.js'),
    useTsx: false,
    cwd: path.join(process.resourcesPath, 'server'),
  };
}

/**
 * @returns {Promise<{ ok: boolean, deviceSyncEnabled: boolean }>}
 */
function probeHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        const statusOk = Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 500);
        let deviceSyncEnabled = true;
        try {
          const json = JSON.parse(body);
          deviceSyncEnabled = json.deviceSyncEnabled !== false;
        } catch {
          /* non-JSON health is still usable */
        }
        resolve({ ok: statusOk, deviceSyncEnabled });
      });
    });
    req.on('error', () => resolve({ ok: false, deviceSyncEnabled: false }));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve({ ok: false, deviceSyncEnabled: false });
    });
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '127.0.0.1');
  });
}

function findFreePort(startPort, maxAttempts = 20) {
  return (async () => {
    for (let i = 0; i < maxAttempts; i++) {
      const candidate = startPort + i;
      if (await isPortFree(candidate)) return candidate;
    }
    throw new Error(`No free local port found near ${startPort}`);
  })();
}

function execFileAsync(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 8000 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

/**
 * If port is held by a previous Attendance Desktop.exe (ELECTRON_RUN_AS_NODE) child,
 * terminate only that PID so we can reclaim DEFAULT_API_PORT.
 */
async function tryKillStaleAttendanceApiOnPort(port) {
  if (process.platform !== 'win32') return false;

  const netstat = await execFileAsync('cmd.exe', [
    '/c',
    `netstat -ano | findstr :${port} | findstr LISTENING`,
  ]);
  if (!netstat.ok || !netstat.stdout.trim()) return false;

  const pids = new Set();
  for (const line of netstat.stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    const pid = Number(parts[parts.length - 1]);
    if (Number.isFinite(pid) && pid > 0) pids.add(pid);
  }

  let killed = false;
  for (const pid of pids) {
    if (pid === process.pid) continue;
    const wmic = await execFileAsync('cmd.exe', [
      '/c',
      `wmic process where ProcessId=${pid} get ExecutablePath /value`,
    ]);
    const exePath = (wmic.stdout.match(/ExecutablePath=(.+)/i) || [])[1]?.trim() || '';
    const isAttendance =
      /Attendance( Desktop)?\.exe$/i.test(exePath) ||
      exePath.toLowerCase() === String(process.execPath).toLowerCase();
    if (!isAttendance) {
      appendStartupLog(
        `[Electron] Port ${port} held by non-Attendance PID ${pid} (${exePath || 'unknown'}); leaving it alone`,
      );
      continue;
    }
    appendStartupLog(`[Electron] Killing stale Attendance API PID ${pid} on port ${port}`);
    await execFileAsync('taskkill', ['/PID', String(pid), '/F', '/T']);
    killed = true;
  }

  if (killed) {
    await new Promise((r) => setTimeout(r, 500));
  }
  return killed;
}

function waitForHealth(port, options = {}) {
  const timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? HEALTH_INTERVAL_MS;
  const isProcessAlive = options.isProcessAlive;
  const getLogTail = options.getLogTail;
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (typeof isProcessAlive === 'function' && !isProcessAlive()) {
        const tail = typeof getLogTail === 'function' ? getLogTail() : '';
        reject(
          new Error(
            `API process exited before becoming healthy on port ${port}` +
              (apiExitCode != null ? ` (exit code ${apiExitCode}` : '') +
              (apiExitSignal ? `, signal ${apiExitSignal}` : '') +
              (apiExitCode != null || apiExitSignal ? ')' : '') +
              (tail ? `\n\nLast API output:\n${tail}` : ''),
          ),
        );
        return;
      }

      probeHealth(port).then((result) => {
        if (result.ok) {
          resolve(true);
          return;
        }
        if (Date.now() - started > timeoutMs) {
          const tail = typeof getLogTail === 'function' ? getLogTail() : '';
          reject(
            new Error(
              `API health check timed out on port ${port} after ${timeoutMs}ms` +
                (tail
                  ? `\n\nLast API output:\n${tail}`
                  : `\n\nNo API output was captured.\nLog file: ${getApiLogPath()}`),
            ),
          );
          return;
        }
        setTimeout(attempt, intervalMs);
      });
    };
    attempt();
  });
}

async function chooseApiPort() {
  apiPort = DEFAULT_API_PORT;

  const existing = await probeHealth(apiPort);
  if (existing.ok && existing.deviceSyncEnabled) {
    appendStartupLog(`[Electron] Reusing existing LAN-capable API on port ${apiPort}`);
    apiStartedByUs = false;
    return { reuse: true };
  }

  if (existing.ok && !existing.deviceSyncEnabled) {
    apiPort = await findFreePort(DEFAULT_API_PORT + 2);
    appendStartupLog(
      `[Electron] Port ${DEFAULT_API_PORT} has device sync disabled; starting local API on ${apiPort}`,
    );
    return { reuse: false };
  }

  const free = await isPortFree(apiPort);
  if (!free) {
    const killed = await tryKillStaleAttendanceApiOnPort(apiPort);
    if (killed && (await isPortFree(apiPort))) {
      appendStartupLog(`[Electron] Reclaimed port ${apiPort} after killing stale Attendance API`);
      return { reuse: false };
    }
    apiPort = await findFreePort(DEFAULT_API_PORT + 1);
    appendStartupLog(
      `[Electron] Port ${DEFAULT_API_PORT} busy; starting local API on ${apiPort}`,
    );
  }

  return { reuse: false };
}

async function ensureApiServer() {
  if (API_TARGET_OVERRIDE) {
    appendStartupLog(`[Electron] Using ELECTRON_API_TARGET override: ${API_TARGET_OVERRIDE}`);
    return;
  }

  if (apiProcess && !apiProcess.killed) {
    return;
  }

  ensureLogsDir();
  openApiLogStream();

  const choice = await chooseApiPort();
  if (choice.reuse) {
    closeApiLogStream();
    return;
  }

  const { entry, useTsx, cwd } = resolveServerEntry();
  appendStartupLog(`[Electron] Resolved API entry: ${entry}`);
  appendStartupLog(`[Electron] API cwd: ${cwd}`);
  appendStartupLog(`[Electron] API port: ${apiPort}`);
  appendStartupLog(`[Electron] Packaged: ${app.isPackaged}`);
  if (!isDev) {
    appendStartupLog(`[Electron] resourcesPath: ${process.resourcesPath}`);
  }

  if (!fs.existsSync(entry)) {
    throw new Error(
      `Attendance API entry not found:\n${entry}\n\n` +
        'The installer is missing the compiled backend. Rebuild with "npm run electron:build".\n' +
        `Log: ${getApiLogPath()}`,
    );
  }

  if (!isDev) {
    const expressPkg = path.join(cwd, 'node_modules', 'express', 'package.json');
    if (!fs.existsSync(expressPkg)) {
      throw new Error(
        'Attendance API dependencies are missing from this install.\n\n' +
          `Expected: ${expressPkg}\n\n` +
          'electron-builder skipped gitignored node_modules. Rebuild with afterPack ' +
          '(npm run electron:build) and reinstall.\n' +
          `Log: ${getApiLogPath()}`,
      );
    }
  }

  const env = loadDesktopEnv();
  let command;
  /** @type {string[]} */
  let args;

  if (useTsx) {
    const tsxCli = path.join(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
    command = process.execPath;
    args = [tsxCli, entry];
    env.ELECTRON_RUN_AS_NODE = '1';
  } else {
    command = process.execPath;
    args = [entry];
    env.ELECTRON_RUN_AS_NODE = '1';
  }

  appendStartupLog(`[Electron] Starting API: ${command} ${args.join(' ')}`);

  /** @type {string[]} */
  const apiLogTail = [];
  const pushApiLog = (chunk) => {
    const text = String(chunk).trimEnd();
    if (!text) return;
    for (const line of text.split(/\r?\n/)) {
      apiLogTail.push(line);
      if (apiLogTail.length > 80) apiLogTail.shift();
    }
  };
  const getLogTail = () => apiLogTail.slice(-20).join('\n');

  apiExitCode = null;
  apiExitSignal = null;

  apiProcess = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  apiStartedByUs = true;

  apiProcess.stdout?.on('data', (chunk) => {
    pushApiLog(chunk);
    writeApiLog(chunk, 'stdout');
    console.log(`[API] ${String(chunk).trimEnd()}`);
  });
  apiProcess.stderr?.on('data', (chunk) => {
    pushApiLog(chunk);
    writeApiLog(chunk, 'stderr');
    console.error(`[API] ${String(chunk).trimEnd()}`);
  });
  apiProcess.on('error', (err) => {
    appendStartupLog(`[Electron] Failed to spawn API: ${err.message}`);
    pushApiLog(`spawn error: ${err.message}`);
  });
  apiProcess.on('exit', (code, signal) => {
    apiExitCode = code;
    apiExitSignal = signal;
    appendStartupLog(`[Electron] API exited code=${code} signal=${signal}`);
    apiProcess = null;
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        'Attendance API stopped',
        'The local attendance service exited unexpectedly. Device sync and API calls will fail until you restart the app.\n\n' +
          `Log: ${getApiLogPath()}`,
      );
    }
  });

  try {
    await waitForHealth(apiPort, {
      timeoutMs: HEALTH_TIMEOUT_MS,
      intervalMs: HEALTH_INTERVAL_MS,
      isProcessAlive: () => Boolean(apiProcess && apiProcess.exitCode == null),
      getLogTail,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    appendStartupLog(`[Electron] API startup failed: ${detail}`);
    stopApiServer();
    throw new Error(`${detail}\n\nResolved entry: ${entry}\nPort: ${apiPort}\nLog: ${getApiLogPath()}`);
  }

  appendStartupLog(`[Electron] Local API ready at ${getLocalApiOrigin()}/api`);
}

function stopApiServer() {
  if (!apiStartedByUs || !apiProcess) {
    apiProcess = null;
    closeApiLogStream();
    return;
  }
  const child = apiProcess;
  apiProcess = null;
  apiStartedByUs = false;
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
  closeApiLogStream();
}

async function resolveStartUrl() {
  if (isDev) {
    return DEV_URL;
  }
  if (API_TARGET_OVERRIDE) {
    return API_TARGET_OVERRIDE;
  }
  return getLocalApiOrigin();
}

function createWindow(startUrl) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch {
      /* ignore invalid URLs */
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = new URL(startUrl);
    let next;
    try {
      next = new URL(url);
    } catch {
      event.preventDefault();
      return;
    }
    const sameOrigin = next.origin === allowed.origin;
    if (!sameOrigin) {
      event.preventDefault();
      if (next.protocol === 'http:' || next.protocol === 'https:') {
        shell.openExternal(url);
      }
    }
  });

  mainWindow.loadURL(startUrl).catch((err) => {
    console.error('[Electron] Failed to load UI:', err);
    dialog.showErrorBox(
      'Attendance — startup failure',
      isDev
        ? `Could not open the development URL:\n${startUrl}\n\nIs Vite running? (${err.message})`
        : `Could not load the desktop UI.\n\n${err.message}`,
    );
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('desktop:get-api-base-url', () => {
  // Same-origin relative path — main process proxies /api to the local Express API.
  return '/api';
});

ipcMain.handle('desktop:get-local-api-origin', () => getLocalApiOrigin());

/** @type {boolean} */
let updateDownloadedPromptOpen = false;

function setupAutoUpdater() {
  // Never run updater wiring in unpackaged/dev sessions.
  if (!app.isPackaged) {
    appendStartupLog('[AutoUpdater] Skipping setup (app is not packaged)');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'prabinknl',
    repo: 'Desktop-Attendance',
  });

  const sendStatus = (status, data = {}) => {
    // Log status keys only — never tokens, passwords, or full error stacks with secrets.
    const safe = { ...data };
    if (typeof safe.error === 'string') {
      safe.error = safe.error.replace(/(gh[pousr]_|github_pat_|token)[^\s]+/gi, '[redacted]');
    }
    appendStartupLog(`[AutoUpdater] ${status} ${JSON.stringify(safe)}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:status', { status, ...safe });
    }
  };

  autoUpdater.on('checking-for-update', () => {
    sendStatus('checking-for-update');
  });

  autoUpdater.on('update-available', (info) => {
    sendStatus('update-available', {
      version: info?.version,
      releaseDate: info?.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    sendStatus('update-not-available', {
      version: info?.version,
    });
  });

  autoUpdater.on('error', (err) => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    appendStartupLog(`[AutoUpdater Error] ${errorMsg}`);
    sendStatus('error', { error: errorMsg });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    sendStatus('download-progress', {
      bytesPerSecond: progressObj.bytesPerSecond,
      percent: progressObj.percent,
      transferred: progressObj.transferred,
      total: progressObj.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus('update-downloaded', {
      version: info?.version,
      releaseDate: info?.releaseDate,
    });
    void promptInstallUpdate(info?.version);
  });
}

/**
 * Native restart prompt after a successful download.
 * "Later" keeps the app running; autoInstallOnAppQuit installs on next quit.
 */
async function promptInstallUpdate(version) {
  if (updateDownloadedPromptOpen) return;
  updateDownloadedPromptOpen = true;
  try {
    const detail = version ? `Version ${version} is ready.` : undefined;
    const options = {
      type: 'info',
      title: 'Update Ready',
      message:
        'A new version of Attendance Desktop has been downloaded. Restart the application to install the update.',
      detail,
      buttons: ['Restart and Update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    const { response } =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options);
    if (response === 0) {
      appendStartupLog('[AutoUpdater] User chose Restart and Update');
      setImmediate(() => {
        try {
          autoUpdater.quitAndInstall(false, true);
        } catch (err) {
          appendStartupLog(
            `[AutoUpdater quitAndInstall error] ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    } else {
      appendStartupLog(
        '[AutoUpdater] User chose Later — update will install on quit when possible',
      );
    }
  } catch (err) {
    appendStartupLog(
      `[AutoUpdater prompt error] ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    updateDownloadedPromptOpen = false;
  }
}

function checkAutoUpdateOnLaunch() {
  if (!app.isPackaged) {
    appendStartupLog('[AutoUpdater] Skipping auto update check (not packaged / development)');
    return;
  }
  try {
    appendStartupLog(
      `[AutoUpdater] Checking GitHub Releases (current version ${app.getVersion()})...`,
    );
    // Non-blocking: network failures must never prevent the app from opening.
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      appendStartupLog(`[AutoUpdater check error] ${err?.message || String(err)}`);
    });
  } catch (err) {
    appendStartupLog(`[AutoUpdater launch error] ${err?.message || String(err)}`);
  }
}

ipcMain.handle('desktop:get-app-version', () => app.getVersion());

ipcMain.handle('desktop:check-for-updates', async () => {
  if (!app.isPackaged) {
    return { status: 'dev-mode', version: app.getVersion(), isDev: true };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: 'checking', version: app.getVersion(), updateInfo: result?.updateInfo };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('desktop:restart-and-install', () => {
  if (!app.isPackaged) {
    return { status: 'dev-mode' };
  }
  try {
    autoUpdater.quitAndInstall(false, true);
    return { status: 'installing' };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
});

async function bootstrap() {
  try {
    ensureLogsDir();
    setupAutoUpdater();
    await ensureApiServer();
    const startUrl = await resolveStartUrl();
    appendStartupLog(`[Electron] UI start URL: ${startUrl}`);
    createWindow(startUrl);
    checkAutoUpdateOnLaunch();
  } catch (err) {
    console.error('[Electron] Startup failed:', err);
    appendStartupLog(`[Electron] Startup failed: ${err instanceof Error ? err.message : String(err)}`);
    if (!err.message?.includes('Missing production build')) {
      dialog.showErrorBox(
        'Attendance — startup failure',
        err instanceof Error ? err.message : String(err),
      );
    }
    app.quit();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      bootstrap();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopApiServer();
});

app.on('will-quit', () => {
  isQuitting = true;
  stopApiServer();
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
});
