'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Minimal, validated bridge for the Attendance desktop shell.
 * No Node APIs are exposed to the renderer.
 * Values from contextBridge are immutable — do not mutate this object.
 */
contextBridge.exposeInMainWorld('attendanceDesktop', Object.freeze({
  isElectron: true,
  /** Absolute API base used by the packaged desktop app (includes /api). */
  apiBaseUrl: 'http://127.0.0.1:3001/api',
  getApiBaseUrl: () => ipcRenderer.invoke('desktop:get-api-base-url'),
  platform: process.platform,
}));
