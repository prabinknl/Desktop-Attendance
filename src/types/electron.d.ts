export interface UpdateProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

export interface UpdateStatusPayload {
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

export interface AttendanceDesktopBridge {
  isElectron?: boolean;
  apiBaseUrl?: string;
  getApiBaseUrl?: () => Promise<string>;
  platform?: string;
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

declare global {
  interface Window {
    attendanceDesktop?: AttendanceDesktopBridge;
  }
}
