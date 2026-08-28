/**
 * Electron main process entry.
 *
 * Desktop (Electron runtime): loads ./main-electron.cjs.
 * Plain Node (Hostinger): starts the compiled Express server. Never require('electron').
 */
'use strict';

if (!process.versions.electron) {
  process.env.NODE_ENV ??= 'production';
  process.env.APP_PUBLIC_URL ??= 'https://desktop-attendance.appnep.com';
  process.env.DEVICE_SYNC_ENABLED ??= 'false';
  const fs = require('fs');
  const path = require('path');
  const { pathToFileURL } = require('url');
  const entry = path.join(__dirname, '..', 'server', 'dist', 'index.js');
  if (!fs.existsSync(entry)) {
    console.error('[Server] server/dist/index.js not found. Run npm run build.');
    process.exit(1);
  }
  import(pathToFileURL(entry).href).catch((err) => {
    console.error('[Server] Failed to start Express:', err);
    process.exit(1);
  });
} else {
  require('./main-electron.cjs');
}
