import axios from 'axios';
import { createApiErrorReporter } from './apiErrors';
import { API_BASE_URL } from './client';
import {
  PRODUCTION_API_BASE_URL,
  isUsableProductionApiUrl,
  normalizeProductionApiUrl,
} from '../lib/productionApi';

/**
 * API client for everything that only the hosted backend can do.
 *
 * The packaged desktop app runs its own Express server on loopback so the
 * Hikvision device on the office LAN stays reachable, but that local server has
 * no SMTP credentials and no database on a customer machine — by design, since
 * mail secrets must never ship inside an installer. Auth, invitations and
 * verification codes therefore go to https://desktop-attendance.appnep.com,
 * where SMTP_* lives in the Hostinger process environment.
 *
 * Device, attendance and core-data traffic keeps using `./client`, which stays
 * on the local server.
 */

function readBridgeCloudUrl(): string {
  if (typeof window === 'undefined') return '';
  const raw = window.attendanceDesktop?.cloudApiBaseUrl;
  return typeof raw === 'string' ? raw.trim() : '';
}

function isDesktopRuntime(): boolean {
  return (
    import.meta.env?.VITE_IS_ELECTRON === 'true' ||
    (typeof window !== 'undefined' && Boolean(window.attendanceDesktop?.isElectron))
  );
}

/**
 * Development keeps the local server so an offline laptop can still work on
 * the signup screens; the console fallback there prints the code instead of
 * mailing it. Only packaged desktop builds are pinned to production.
 */
function isDevelopmentRuntime(): boolean {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) return true;
  if (typeof window === 'undefined') return false;
  // Unpackaged `electron:dev` serves the UI from the Vite dev server on :3000.
  return window.location.port === '3000';
}

export function resolveCloudApiBaseUrl(): string {
  // A runtime override from the Electron main process wins, so a deployment can
  // be repointed without rebuilding the renderer.
  const bridgeUrl = readBridgeCloudUrl();
  if (bridgeUrl) {
    if (isUsableProductionApiUrl(bridgeUrl)) return normalizeProductionApiUrl(bridgeUrl);
    console.warn('[API] Ignoring unusable desktop cloud API URL — using the default production API.');
  }

  if (isDevelopmentRuntime()) return API_BASE_URL;
  if (isDesktopRuntime()) return PRODUCTION_API_BASE_URL;

  // Hosted website: same origin already serves /api next to the frontend.
  return API_BASE_URL;
}

export const CLOUD_API_BASE_URL = resolveCloudApiBaseUrl();

if (typeof console !== 'undefined') {
  console.info(`[API] Auth/email base URL: ${CLOUD_API_BASE_URL}`);
}

const cloudClient = axios.create({
  baseURL: CLOUD_API_BASE_URL,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

cloudClient.interceptors.request.use((config) => {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('ams_user');
      if (raw) {
        const user = JSON.parse(raw);
        if (user?.role) config.headers['x-user-role'] = user.role;
        if (user?.id) config.headers['x-user-id'] = user.id;
      }
    }
  } catch {
    /* ignore */
  }
  return config;
});

const { getReadableApiError, logFailedApiRequest } = createApiErrorReporter({
  baseUrl: CLOUD_API_BASE_URL,
  label: 'online server',
  unreachableHint: 'Check this computer’s internet connection and try again.',
});

export { getReadableApiError as getReadableCloudApiError };

cloudClient.interceptors.response.use(
  (response) => response,
  (error) => {
    logFailedApiRequest(error);
    return Promise.reject(new Error(getReadableApiError(error)));
  },
);

export default cloudClient;
