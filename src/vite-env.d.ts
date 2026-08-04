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

interface UpdateProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

interface UpdateStatusPayload {
  status:
    | 'checking-for-update'
    | 'update-available'
    | 'update-not-available'
    | 'download-progress'
    | 'update-downloaded'
    | 'error';
  version?: string;
  releaseDate?: string;
  releaseNotes?: string | Array<{ version: string; note: string }>;
  error?: string;
  bytesPerSecond?: number;
  percent?: number;
  transferred?: number;
  total?: number;
}

interface AttendanceDesktopBridge {
  readonly isElectron?: boolean;
  readonly apiBaseUrl?: string;
  getApiBaseUrl?: () => Promise<string>;
  readonly platform?: string;
  getAppVersion?: () => Promise<string>;
  checkForUpdates?: () => Promise<{
    status: string;
    version?: string;
    isDev?: boolean;
    error?: string;
    updateInfo?: unknown;
  }>;
  restartAndInstall?: () => Promise<void>;
  onUpdateStatus?: (callback: (payload: UpdateStatusPayload) => void) => () => void;
}

interface Window {
  attendanceDesktop?: AttendanceDesktopBridge;
}
