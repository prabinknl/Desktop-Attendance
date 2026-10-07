/**
 * Electron main process for Attendance.
 * Dev: loads the existing Vite server at http://127.0.0.1:3000 (API via Vite
 * proxy to Express on 3002). Does not start a second frontend server.
 * Prod: loads Express on 3002, which serves both the built UI and /api.
 */
'use strict';

const { app, BrowserWindow, shell, dialog, ipcMain, powerMonitor, safeStorage } = require('electron');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { spawn, execFile } = require('child_process');
const { createUpdater } = require('./updater.cjs');
const {
  loadDeviceCredentialKey,
  stripPlaintextKeyFromEnvFile,
  isValidKey,
} = require('./secure-key.cjs');

// Isolated profile for test runs of a packaged build; never set for normal users.
const USER_DATA_OVERRIDE = (process.env.ATTENDANCE_USER_DATA_DIR || '').trim();
if (USER_DATA_OVERRIDE) {
  app.setPath('userData', path.resolve(USER_DATA_OVERRIDE));
}

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_DEV_URL || 'http://127.0.0.1:3000';
const DEFAULT_API_PORT = 3002;
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_INTERVAL_MS = 400;

/** Optional override — when unset, desktop still starts local Express (LAN devices / UI). */
const API_TARGET_OVERRIDE = (process.env.ELECTRON_API_TARGET || '').replace(/\/$/, '');

/**
 * Hosted backend for auth, invitations and verification codes. The local
 * Express server ships without mail credentials on purpose, so those requests
 * go to Hostinger where SMTP_* lives in the process environment.
 */
const DEFAULT_CLOUD_API_BASE_URL = 'https://desktop-attendance.appnep.com/api';

function getCloudApiBaseUrl() {
  const override = (process.env.ELECTRON_CLOUD_API_TARGET || '').trim();
  if (!override) return DEFAULT_CLOUD_API_BASE_URL;
  try {
    const url = new URL(override);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_CLOUD_API_BASE_URL;
    const base = override.replace(/\/+$/, '');
    return /\/api$/.test(base) ? base : `${base}/api`;
  } catch {
    return DEFAULT_CLOUD_API_BASE_URL;
  }
}

/**
 * Mail secrets must never reach the bundled local server: it does not send
 * mail, and anything it inherits could end up in its log file. Stripped even
 * on the developer machine so packaged behaviour matches what customers run.
 */
const SERVER_SECRET_DENYLIST = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
];

/** Time the local API gets to finish an in-flight attendance sync before a forced stop. */
const API_SHUTDOWN_TIMEOUT_MS = 25_000;

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
  // Installed builds read settings only from the per-user server.env so nothing
  // from a developer machine or the install folder can leak into production.
  if (!isDev) return [getUserServerEnvPath()];
  return [
    getUserServerEnvPath(),
    path.join(__dirname, '..', 'server', '.env'),
    path.join(__dirname, '..', '.env'),
  ];
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
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Key for the stored attendance-machine password. Kept with Windows DPAPI
 * (safeStorage); an older plaintext ENCRYPTION_KEY in server.env is migrated
 * so existing saved device passwords keep working.
 */
function resolveDeviceCredentialKey(userEnvPath, legacyKey) {
  try {
    const result = loadDeviceCredentialKey({
      safeStorage,
      userDataDir: app.getPath('userData'),
      legacyKey,
      log: appendStartupLog,
    });
    if (result.osProtected) {
      try {
        stripPlaintextKeyFromEnvFile(userEnvPath, appendStartupLog);
      } catch (err) {
        appendStartupLog(`[SecureKey] Could not update server.env: ${err.message}`);
      }
    } else if (!isValidKey(legacyKey)) {
      persistPlaintextKey(userEnvPath, result.key);
    }
    return result.key;
  } catch (err) {
    appendStartupLog(`[SecureKey] Protected key unavailable: ${err instanceof Error ? err.message : String(err)}`);
    if (isValidKey(legacyKey)) return legacyKey;
    const key = generateEncryptionKey();
    persistPlaintextKey(userEnvPath, key);
    return key;
  }
}

/** Fallback when OS protection is unavailable: keep the key so saved passwords survive restarts. */
function persistPlaintextKey(userEnvPath, key) {
  try {
    fs.appendFileSync(userEnvPath, `ENCRYPTION_KEY=${key}\n`, 'utf8');
  } catch (err) {
    appendStartupLog(`[SecureKey] Could not persist fallback key: ${err.message}`);
  }
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
  if (isDev && fs.existsSync(devEnvPath)) {
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
  parsed.DEVICE_SYNC_ENABLED = 'true';
  if (!parsed.DATABASE_URL && !parsed.DB_HOST) {
    parsed.USE_MEMORY_STORE = 'true';
  }

  // ENCRYPTION_KEY is not written here: resolveDeviceCredentialKey() keeps it
  // in OS-protected storage.
  const lines = [
    '# Auto-created by Attendance desktop on first launch.',
    '# Edit this file or replace it with your server/.env to share the same database.',
    `# Path: ${userEnvPath}`,
    '',
    `DEVICE_SYNC_ENABLED=${parsed.DEVICE_SYNC_ENABLED}`,
  ];
  if (isValidKey(parsed.ENCRYPTION_KEY)) lines.push(`ENCRYPTION_KEY=${parsed.ENCRYPTION_KEY}`);
  if (parsed.DB_HOST) lines.push(`DB_HOST=${parsed.DB_HOST}`);
  if (parsed.DB_PORT) lines.push(`DB_PORT=${parsed.DB_PORT}`);
  if (parsed.DB_NAME) lines.push(`DB_NAME=${parsed.DB_NAME}`);
  if (parsed.DB_USER) lines.push(`DB_USER=${parsed.DB_USER}`);
  if (parsed.DB_PASSWORD) lines.push(`DB_PASSWORD=${parsed.DB_PASSWORD}`);
  if (parsed.DB_DRIVER) lines.push(`DB_DRIVER=${parsed.DB_DRIVER}`);
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
  const userEnvPath = ensureDesktopServerEnv();

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
          key === 'NODE_ENV' ||
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
  env.ENCRYPTION_KEY = resolveDeviceCredentialKey(userEnvPath, env.ENCRYPTION_KEY);
  env.ATTENDANCE_APP_VERSION = app.getVersion();

  // The local server handles LAN devices only; email goes through the hosted
  // API. Drop any inherited mail credentials so they cannot be used or logged.
  const stripped = [];
  for (const key of SERVER_SECRET_DENYLIST) {
    if (env[key] !== undefined) {
      delete env[key];
      stripped.push(key);
    }
  }
  if (stripped.length > 0) {
    // Names only — values are never written to the log.
    appendStartupLog(`[Electron] Withheld mail credentials from local API: ${stripped.join(', ')}`);
  }
  env.LOCAL_DESKTOP_API = '1';

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
    // IPC channel: graceful shutdown and sleep/resume notifications.
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
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
    forceStopApiServer();
    throw new Error(`${detail}\n\nResolved entry: ${entry}\nPort: ${apiPort}\nLog: ${getApiLogPath()}`);
  }

  appendStartupLog(`[Electron] Local API ready at ${getLocalApiOrigin()}/api`);
}

function sendToApi(message) {
  const child = apiProcess;
  if (!apiStartedByUs || !child || child.exitCode != null || !child.connected) return false;
  try {
    child.send(message);
    return true;
  } catch {
    return false;
  }
}

/** @type {Promise<void> | null} */
let apiShutdownPromise = null;

/**
 * Ask the local API to stop: it finishes an in-flight attendance sync, stops
 * its timers and exits. Forced stop only if it does not exit in time.
 */
function shutdownApiServer(reason, timeoutMs = API_SHUTDOWN_TIMEOUT_MS) {
  if (apiShutdownPromise) return apiShutdownPromise;
  const child = apiProcess;
  if (!apiStartedByUs || !child || child.exitCode != null) {
    forceStopApiServer();
    return Promise.resolve();
  }
  appendStartupLog(`[Electron] Stopping local API (${reason})`);
  apiShutdownPromise = new Promise((resolve) => {
    let settled = false;
    const finish = (how) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      appendStartupLog(`[Electron] Local API stopped (${how})`);
      closeApiLogStream();
      resolve();
    };
    const timer = setTimeout(() => {
      forceStopApiServer();
      finish('forced after timeout');
    }, timeoutMs);
    child.once('exit', () => finish('graceful'));
    if (!sendToApi({ type: 'shutdown', reason })) {
      forceStopApiServer();
      finish('forced, no IPC channel');
    }
  });
  return apiShutdownPromise;
}

function forceStopApiServer() {
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
      'Attendance - startup failure',
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
  return '/api';
});

ipcMain.handle('desktop:get-local-api-origin', () => getLocalApiOrigin());

ipcMain.handle('desktop:get-cloud-api-base-url', () => getCloudApiBaseUrl());

const updater = createUpdater({
  log: appendStartupLog,
  getWindow: () => mainWindow,
  prepareForInstall: async () => {
    isQuitting = true;
    await shutdownApiServer('installing update');
  },
});

ipcMain.handle('desktop:get-app-version', () => app.getVersion());

ipcMain.handle('desktop:get-update-state', () => updater.getState());

ipcMain.handle('desktop:check-for-updates', () => updater.check());

ipcMain.handle('desktop:restart-and-install', () => updater.restartAndInstall());

let powerEventsWired = false;

/** Tell the local API about sleep/resume so the device connection is re-verified promptly. */
function wirePowerEvents() {
  if (powerEventsWired) return;
  powerEventsWired = true;
  powerMonitor.on('suspend', () => {
    appendStartupLog('[Electron] System suspending');
    sendToApi({ type: 'system-suspend' });
  });
  const onResume = (kind) => () => {
    appendStartupLog(`[Electron] System ${kind}`);
    sendToApi({ type: 'system-resume' });
  };
  powerMonitor.on('resume', onResume('resumed'));
  powerMonitor.on('unlock-screen', onResume('unlocked'));
}

let bootstrapped = false;

async function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  try {
    ensureLogsDir();
    appendStartupLog(`[Electron] Attendance Desktop ${app.getVersion()} starting (userData ${app.getPath('userData')})`);
    // Update checks never wait for, or block, the local API.
    updater.start();
    await ensureApiServer();
    wirePowerEvents();
    const startUrl = await resolveStartUrl();
    appendStartupLog(`[Electron] UI start URL: ${startUrl}`);
    appendStartupLog(
      '[Electron] Renderer API base: /api (same origin as UI)',
    );
    createWindow(startUrl);
  } catch (err) {
    console.error('[Electron] Startup failed:', err);
    appendStartupLog(`[Electron] Startup failed: ${err instanceof Error ? err.message : String(err)}`);
    if (!err.message?.includes('Missing production build')) {
      dialog.showErrorBox(
        'Attendance - startup failure',
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
    if (BrowserWindow.getAllWindows().length > 0) return;
    if (!bootstrapped) {
      void bootstrap();
      return;
    }
    void resolveStartUrl().then(createWindow);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let apiStoppedForQuit = false;

app.on('before-quit', (event) => {
  isQuitting = true;
  updater.stop();
  if (apiStoppedForQuit) return;
  if (apiStartedByUs && apiProcess && apiProcess.exitCode == null) {
    // Let an in-flight attendance sync finish before exiting (and before any
    // pending update installer replaces the files).
    event.preventDefault();
    void shutdownApiServer('app quit').finally(() => {
      apiStoppedForQuit = true;
      app.quit();
    });
  }
});

app.on('will-quit', () => {
  isQuitting = true;
  forceStopApiServer();
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
});
