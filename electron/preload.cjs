'use strict';

/**
 * Secure bridge for the Attendance desktop shell.
 * Device passwords and tokens are never exposed here.
 *
 * Packaged Electron: Loads UI from local backend (localhost:3002) and calls
 * relative /api to reach the same local backend. This enables device sync.
 *
 * Unpackaged `electron:dev`: Uses relative /api so Vite proxy (port 3000)
 * proxies to local Express (port 3002).
 *
 * Auth, invitations and verification codes are the exception: they need SMTP
 * and the shared database, which only the hosted backend has, so they use
 * `cloudApiBaseUrl` instead. No credential is ever exposed here — only the
 * public URL of that backend.
 */
const { contextBridge, ipcRenderer } = require('electron');

/**
 * Hosted backend for auth, invitations and verification codes. The bundled
 * local server deliberately has no SMTP credentials, so those calls must leave
 * the machine. Overridable for staging via ELECTRON_CLOUD_API_TARGET.
 */
const DEFAULT_CLOUD_API_BASE_URL = 'https://desktop-attendance.appnep.com/api';

function resolveCloudApiBaseUrl() {
  let override = '';
  try {
    // Sandboxed preloads expose only a subset of `process`; never assume env.
    override = String((process.env && process.env.ELECTRON_CLOUD_API_TARGET) || '').trim();
  } catch {
    override = '';
  }
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

const CLOUD_API_BASE_URL = resolveCloudApiBaseUrl();

contextBridge.exposeInMainWorld(
  'attendanceDesktop',
  Object.freeze({
    isElectron: true,
    apiBaseUrl: '/api',
    // Public hosted API for auth/email. Server secrets (SMTP_*, DB_*) are never
    // exposed across this bridge — only this public URL.
    cloudApiBaseUrl: CLOUD_API_BASE_URL,
    getApiBaseUrl: () => ipcRenderer.invoke('desktop:get-api-base-url'),
    getCloudApiBaseUrl: () => ipcRenderer.invoke('desktop:get-cloud-api-base-url'),
    platform: process.platform,
    getAppVersion: () => ipcRenderer.invoke('desktop:get-app-version'),
    checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
    restartAndInstall: () => ipcRenderer.invoke('desktop:restart-and-install'),
    onUpdateStatus: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = (_event, value) => callback(value);
      ipcRenderer.on('updater:status', handler);
      return () => {
        ipcRenderer.removeListener('updater:status', handler);
      };
    },
  }),
);

