/**
 * Electron main process for Attendance Desktop.
 * Dev: loads Vite at http://127.0.0.1:3002 (API via Vite proxy or local spawn).
 * Prod: serves dist-electron/ on loopback, spawns the local Express API with
 * DEVICE_SYNC_ENABLED, and proxies /api to that local process so Hikvision
 * LAN discovery/sync works. Cloud Fly.dev cannot reach private LAN IPs.
 *
 * User data lives under %APPDATA%\Attendance Desktop — never under Program Files.
 */
'use strict';

const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');

const APP_DISPLAY_NAME = 'Attendance Desktop';
const isDev = !app.isPackaged;
const DEFAULT_API_PORT = 3001;

app.setName(APP_DISPLAY_NAME);
try {
  app.setPath('userData', path.join(app.getPath('appData'), APP_DISPLAY_NAME));
} catch (err) {
  console.warn('[Electron] Could not set userData path:', err);
}

const DEV_URL = process.env.ELECTRON_DEV_URL || 'http://127.0.0.1:3002';
/** Optional override — when unset, desktop always uses the local Express API. */
const API_TARGET_OVERRIDE = (process.env.ELECTRON_API_TARGET || '').replace(/\/$/, '');

let mainWindow = null;
let staticServer = null;
let staticServerPort = null;
/** @type {import('child_process').ChildProcess | null} */
let apiProcess = null;
let apiPort = DEFAULT_API_PORT;
let apiStartedByUs = false;
let isQuitting = false;

function resolveAppIcon() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(process.resourcesPath || '', 'icon.ico'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function getDistPath() {
  return path.join(__dirname, '..', 'dist-electron');
}

function getLocalApiOrigin() {
  return `http://127.0.0.1:${apiPort}`;
}

function getApiProxyOrigin() {
  if (API_TARGET_OVERRIDE) return API_TARGET_OVERRIDE;
  return getLocalApiOrigin();
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json',
  };
  return map[ext] || 'application/octet-stream';
}

function proxyApiRequest(req, res) {
  const apiOrigin = getApiProxyOrigin();
  let target;
  try {
    target = new URL(req.url, `${apiOrigin}/`);
  } catch {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: 'Invalid backend API URL configuration.' }));
    return;
  }

  if (target.origin !== new URL(apiOrigin).origin) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: 'Backend connection refused: unexpected API host.' }));
    return;
  }

  const transport = target.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: target.host };
  delete headers['accept-encoding'];

  const proxyReq = transport.request(
    target,
    { method: req.method, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (err) => {
    console.error('[Electron] Local API proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          message:
            'Local attendance API is not reachable. Restart the app or check that the local service started.',
        }),
      );
    }
  });

  req.pipe(proxyReq);
}

function serveStatic(req, res, distPath) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const safeSuffix = urlPath === '/' ? '/index.html' : urlPath;
  const candidate = path.normalize(path.join(distPath, safeSuffix));

  if (!candidate.startsWith(distPath)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const tryFile = (filePath, fallbackToIndex) => {
    fs.readFile(filePath, (err, data) => {
      if (!err) {
        res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
        res.end(data);
        return;
      }
      if (fallbackToIndex) {
        const indexPath = path.join(distPath, 'index.html');
        fs.readFile(indexPath, (indexErr, indexData) => {
          if (indexErr) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(indexData);
        });
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    });
  };

  fs.stat(candidate, (err, stat) => {
    if (!err && stat.isFile()) {
      tryFile(candidate, false);
      return;
    }
    tryFile(path.join(distPath, 'index.html'), false);
  });
}

function startProductionServer(distPath) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if ((req.url || '').startsWith('/api')) {
        proxyApiRequest(req, res);
        return;
      }
      serveStatic(req, res, distPath);
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind local desktop static server.'));
        return;
      }
      staticServer = server;
      staticServerPort = address.port;
      resolve(address.port);
    });
  });
}

function assertProductionBuildExists(distPath) {
  const indexHtml = path.join(distPath, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    const message =
      `Missing production build files at:\n${indexHtml}\n\n` +
      'Run "npm run electron:build" or "npm run electron:pack" first.';
    console.error('[Electron]', message);
    dialog.showErrorBox(`${APP_DISPLAY_NAME} — missing build`, message);
    throw new Error(message);
  }
}

function resolveEnvFilePaths() {
  const candidates = [];
  if (!isDev) {
    candidates.push(path.join(process.resourcesPath, 'server', '.env'));
    candidates.push(path.join(app.getPath('userData'), 'server.env'));
  }
  candidates.push(path.join(__dirname, '..', 'server', '.env'));
  candidates.push(path.join(__dirname, '..', '.env'));
  return candidates;
}

function loadDesktopEnv() {
  const env = {
    ...process.env,
    ELECTRON_DESKTOP: '1',
    DEVICE_SYNC_ENABLED: process.env.DEVICE_SYNC_ENABLED ?? 'true',
    PORT: String(apiPort),
    CORS_ORIGINS: process.env.CORS_ORIGINS ?? '*',
  };

  for (const filePath of resolveEnvFilePaths()) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const text = fs.readFileSync(filePath, 'utf8');
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
        if (key === 'PORT' || key === 'ELECTRON_DESKTOP') continue;
        env[key] = value;
      }
      console.log(`[Electron] Loaded server env from ${filePath}`);
      break;
    } catch (err) {
      console.warn(`[Electron] Failed reading ${filePath}:`, err.message);
    }
  }

  env.PORT = String(apiPort);
  env.ELECTRON_DESKTOP = '1';
  if (!env.DEVICE_SYNC_ENABLED) env.DEVICE_SYNC_ENABLED = 'true';
  if (!env.CORS_ORIGINS) env.CORS_ORIGINS = '*';
  return env;
}

function resolveServerEntry() {
  if (isDev) {
    const compiled = path.join(__dirname, '..', 'server', 'dist', 'index.js');
    if (fs.existsSync(compiled)) {
      return { entry: compiled, useTsx: false, cwd: path.join(__dirname, '..') };
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

function waitForHealth(port, timeoutMs = 45000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve(true);
          return;
        }
        retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`API health check timed out on port ${port}`));
        return;
      }
      setTimeout(attempt, 400);
    };
    attempt();
  });
}

async function ensureApiServer() {
  if (API_TARGET_OVERRIDE) {
    console.log(`[Electron] Using ELECTRON_API_TARGET override: ${API_TARGET_OVERRIDE}`);
    return;
  }

  if (apiProcess && !apiProcess.killed) {
    return;
  }

  try {
    await waitForHealth(apiPort, 2500);
    console.log(`[Electron] Reusing existing API on port ${apiPort}`);
    apiStartedByUs = false;
    return;
  } catch {
    /* start our own */
  }

  const { entry, useTsx, cwd } = resolveServerEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(
      `Attendance API entry not found:\n${entry}\n\n` +
        'Run "npm run build:server" before packaging, and ensure server/.env ' +
        `(or %APPDATA%\\${APP_DISPLAY_NAME}\\server.env) exists.`,
    );
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

  console.log(`[Electron] Starting local API for LAN device access: ${args.join(' ')}`);
  apiProcess = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  apiStartedByUs = true;

  apiProcess.stdout?.on('data', (chunk) => {
    console.log(`[API] ${String(chunk).trimEnd()}`);
  });
  apiProcess.stderr?.on('data', (chunk) => {
    console.error(`[API] ${String(chunk).trimEnd()}`);
  });
  apiProcess.on('exit', (code, signal) => {
    console.log(`[Electron] API exited code=${code} signal=${signal}`);
    apiProcess = null;
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        'Attendance API stopped',
        'The local attendance service exited unexpectedly. Device sync and API calls will fail until you restart the app.',
      );
    }
  });

  await waitForHealth(apiPort);
  console.log(`[Electron] Local API ready at ${getLocalApiOrigin()}/api`);
}

function stopApiServer() {
  if (!apiStartedByUs || !apiProcess) {
    apiProcess = null;
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
}

async function resolveStartUrl() {
  if (isDev) {
    return DEV_URL;
  }
  const distPath = getDistPath();
  assertProductionBuildExists(distPath);
  const port = await startProductionServer(distPath);
  return `http://127.0.0.1:${port}`;
}

function createWindow(startUrl) {
  const icon = resolveAppIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: APP_DISPLAY_NAME,
    ...(icon ? { icon } : {}),
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
      `${APP_DISPLAY_NAME} — startup failure`,
      isDev
        ? `Could not open the development URL:\n${startUrl}\n\nIs Vite running? (${err.message})`
        : `Could not load the desktop UI.\n\n${err.message}`,
    );
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('desktop:get-api-base-url', () => '/api');
ipcMain.handle('desktop:get-local-api-origin', () => getLocalApiOrigin());

async function bootstrap() {
  try {
    await ensureApiServer();
    const startUrl = await resolveStartUrl();
    console.log(`[Electron] UI start URL: ${startUrl}`);
    console.log(`[Electron] API proxy target: ${getApiProxyOrigin()}`);
    createWindow(startUrl);
  } catch (err) {
    console.error('[Electron] Startup failed:', err);
    if (!err.message?.includes('Missing production build')) {
      dialog.showErrorBox(
        `${APP_DISPLAY_NAME} — startup failure`,
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
  if (staticServer) {
    staticServer.close();
    staticServer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopApiServer();
});

app.on('will-quit', () => {
  stopApiServer();
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
});
