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
 */
const { contextBridge, ipcRenderer } = require('electron');

const isPackaged = __dirname.includes('app.asar');

contextBridge.exposeInMainWorld(
  'attendanceDesktop',
  Object.freeze({
    isElectron: true,
    apiBaseUrl: '/api',
    getApiBaseUrl: () => ipcRenderer.invoke('desktop:get-api-base-url'),
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

