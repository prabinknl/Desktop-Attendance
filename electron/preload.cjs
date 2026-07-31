'use strict';

/**
 * Minimal bridge for the Attendance desktop shell.
 * Main process serves the UI on a loopback port and proxies /api to the cloud API,
 * so the renderer should use a same-origin relative /api base URL.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld(
  'attendanceDesktop',
  Object.freeze({
    isElectron: true,
    apiBaseUrl: '/api',
    getApiBaseUrl: async () => '/api',
    platform: process.platform,
  }),
);
