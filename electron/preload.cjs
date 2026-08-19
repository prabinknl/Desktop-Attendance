'use strict';

/**
 * Secure bridge for the Attendance desktop shell.
 * Device passwords and tokens are never exposed here.
 * Local Hikvision access runs in the main-process Express API; the renderer
 * only receives a same-origin relative /api base URL.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'attendanceDesktop',
  Object.freeze({
    isElectron: true,
    /** Same-origin relative path — Express serves both UI and /api directly on the same port. */
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

