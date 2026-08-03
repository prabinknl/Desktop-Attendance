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
    /** Same-origin relative path — Electron main proxies to the local API. */
    apiBaseUrl: '/api',
    getApiBaseUrl: () => ipcRenderer.invoke('desktop:get-api-base-url'),
    platform: process.platform,
  }),
);
