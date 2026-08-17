'use strict';

const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;
const DEFAULT_API_PORT = 3001;
const DEV_UI_URL = 'http://127.0.0.1:3002';
const MIN_WIDTH = 1024;
const MIN_HEIGHT = 680;

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** @type {import('child_process').ChildProcess | null} */
let apiProcess = null;
let apiPort = DEFAULT_API_PORT;
let isQuitting = false;
/** True when this process started the API (must stop it on quit). */
let apiStartedByUs = false;

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  const defaults = {
    width: 1280,
    height: 800,
    x: undefined,
    y: undefined,
    isMaximized: false,
  };
  try {
    const raw = fs.readFileSync(windowStatePath(), 'utf8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const state = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized: win.isMaximized(),
  };
  try {
    fs.writeFileSync(windowStatePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Electron] Failed to save window state:', err);
  }
}

function getApiBaseUrl() {
  return `http://127.0.0.1:${apiPort}/api`;
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
      console.warn(`[Electron] Failed reading ${filePath}:`, err);
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
  if (apiProcess && !apiProcess.killed) {
    return;
  }

  // In electron:dev, `dev:server` may already be running — reuse it.
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
      `Attendance API entry not found:\n${entry}\n\nRun "npm run build:server" before packaging, and ensure server/.env (or %APPDATA%\\Attendance\\server.env) exists.`,
    );
  }

  const env = loadDesktopEnv();
  /** @type {string[]} */
  let args;
  /** @type {string} */
  let command;

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

  console.log(`[Electron] Starting API: ${command} ${args.join(' ')}`);
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
  console.log(`[Electron] API ready at ${getApiBaseUrl()}`);
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

function getRendererIndexPath() {
  // Packaged: UI lives next to electron/ inside app.asar (files include dist-electron)
  if (isDev) {
    return path.join(__dirname, '..', 'dist-electron', 'index.html');
  }
  return path.join(app.getAppPath(), 'dist-electron', 'index.html');
}

function createMainWindow() {
  const state = loadWindowState();
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    title: 'Attendance',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (state.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', () => {
    saveWindowState(mainWindow);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedDev = isDev && url.startsWith(DEV_UI_URL);
    const allowedFile = url.startsWith('file:');
    const allowedHashNav =
      !isDev &&
      (url.startsWith('file:') || url.includes('index.html'));
    if (allowedDev || allowedFile || allowedHashNav) return;
    if (url.startsWith('http:') || url.startsWith('https:')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (isDev) {
    mainWindow.loadURL(DEV_UI_URL).catch((err) => {
      dialog.showErrorBox(
        'Failed to load Attendance',
        `Could not open the Vite dev server at ${DEV_UI_URL}.\n\n${err.message}\n\nStart it with npm run electron:dev.`,
      );
    });
  } else {
    const indexHtml = getRendererIndexPath();
    if (!fs.existsSync(indexHtml)) {
      dialog.showErrorBox(
        'Failed to load Attendance',
        `Missing UI build:\n${indexHtml}\n\nRebuild with npm run electron:build.`,
      );
    } else {
      mainWindow.loadFile(indexHtml).catch((err) => {
        dialog.showErrorBox(
          'Failed to load Attendance',
          `Could not open the packaged UI.\n\n${err.message}`,
        );
      });
    }
  }
}

ipcMain.handle('desktop:get-api-base-url', () => {
  const url = getApiBaseUrl();
  if (typeof url !== 'string' || !/^https?:\/\/127\.0\.0\.1:\d+\/api$/.test(url)) {
    return 'http://127.0.0.1:3001/api';
  }
  return url;
});

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

  app.whenReady().then(async () => {
    try {
      await ensureApiServer();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dialog.showErrorBox(
        'Attendance API failed to start',
        `${message}\n\nHikvision device sync and cloud API calls need the local service.\n\nCheck server/.env (DATABASE_URL) or create %APPDATA%\\Attendance\\server.env from server/.env.example.`,
      );
    }

    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
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
  stopApiServer();
});
