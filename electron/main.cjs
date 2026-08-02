/**
 * Electron main process for Attendance Desktop.
 * Dev: loads the Vite app at http://127.0.0.1:3002 (API via Vite proxy).
 * Prod: serves dist-electron/ over localhost and proxies /api to the cloud API
 * so the frontend can keep using relative /api (no secrets baked in).
 *
 * User data (Chromium profile, caches, optional desktop config) lives under
 * %APPDATA%\Attendance Desktop — never under Program Files.
 */
const { app, BrowserWindow, shell, dialog } = require('electron');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const APP_DISPLAY_NAME = 'Attendance Desktop';
const isDev = !app.isPackaged;

// Keep session / localStorage / caches outside the install directory.
app.setName(APP_DISPLAY_NAME);
try {
  app.setPath('userData', path.join(app.getPath('appData'), APP_DISPLAY_NAME));
} catch (err) {
  console.warn('[Electron] Could not set userData path:', err);
}

const DEV_URL = process.env.ELECTRON_DEV_URL || 'http://127.0.0.1:3002';
/** Public API origin only — never put passwords or service-role keys here. */
const DEFAULT_API_ORIGIN =
  'https://attendance-api-b8a4b02c-6a27-402f-8cc4-ba21910570f4.fly.dev';
const API_ORIGIN = (process.env.ELECTRON_API_TARGET || DEFAULT_API_ORIGIN).replace(/\/$/, '');

let mainWindow = null;
let staticServer = null;
let staticServerPort = null;

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
  // Packaged builds use vite.config.electron.ts → dist-electron/
  return path.join(__dirname, '..', 'dist-electron');
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
  let target;
  try {
    target = new URL(req.url, `${API_ORIGIN}/`);
  } catch {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: 'Invalid backend API URL configuration.' }));
    return;
  }

  if (target.origin !== new URL(API_ORIGIN).origin) {
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
    console.error('[Electron] Backend proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          message: 'Backend server is not reachable. Check your network or ELECTRON_API_TARGET.',
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
    // SPA fallback for client-side routes
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
    // Port 0 → OS assigns a free port (avoids collisions).
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

async function bootstrap() {
  try {
    const startUrl = await resolveStartUrl();
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

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (staticServer) {
    staticServer.close();
    staticServer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    bootstrap();
  }
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
});
