/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin for hosted builds, e.g. https://attendance-api.fly.dev/api.
   *  Unset locally so requests go through the Vite proxy on /api. */
  readonly VITE_API_BASE_URL?: string;
  /** Set at Electron UI build time (`vite.config.electron.ts`). */
  readonly VITE_IS_ELECTRON?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface AttendanceDesktopBridge {
  readonly isElectron: true;
  readonly apiBaseUrl: string;
  getApiBaseUrl: () => Promise<string>;
  readonly platform: string;
}

interface Window {
  attendanceDesktop?: AttendanceDesktopBridge;
}
