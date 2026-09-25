/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin for hosted builds, e.g. https://desktop-attendance.appnep.com/api.
   *  Desktop and local web use /api on the local backend or Vite proxy. Public URL only — not a secret. */
  readonly VITE_API_BASE_URL?: string;
  /** Set true to use legacy InsForge browser OTP during migration. Default: off (Hostinger API). */
  readonly VITE_USE_INSFORGE_OTP?: string;
  /** Legacy InsForge backend URL for hosted owner OTP (auth emails). */
  readonly VITE_INSFORGE_URL?: string;
  /** Legacy InsForge anon key for hosted owner OTP. */
  readonly VITE_INSFORGE_ANON_KEY?: string;
  /** Set at Electron UI build time (`vite.config.electron.ts`). */
  readonly VITE_IS_ELECTRON?: string;
  /** Public hosted API used for auth/email endpoints, e.g. https://desktop-attendance.appnep.com/api.
   *  Public URL only — SMTP_* and other server secrets must never be exposed as VITE_* variables. */
  readonly VITE_CLOUD_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** App version stamped from package.json at build time by both Vite configs. */
declare const __APP_VERSION__: string;

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
  /** Hosted API for auth/email endpoints. Public URL only — never a credential. */
  readonly cloudApiBaseUrl?: string;
  getApiBaseUrl?: () => Promise<string>;
  getCloudApiBaseUrl?: () => Promise<string>;
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
