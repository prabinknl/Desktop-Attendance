import axios, { AxiosError } from 'axios';
import { PRODUCTION_API_BASE_URL } from '../lib/productionApi';

function isHostedFrontendOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname.endsWith('.insforge.site') ||
      hostname.endsWith('.appnep.com') ||
      hostname === 'desktop-attendance.appnep.com' ||
      hostname === 'attendance.appnep.com'
    );
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return /^(localhost|127\.0\.0\.1)$/i.test(hostname);
}

function ensureApiPath(url: URL, raw: string): string {
  const path = url.pathname.replace(/\/$/, '');
  if (path === '/api' || path.endsWith('/api')) return raw.replace(/\/$/, '');
  return `${url.origin}/api`;
}

function normalizeHttpApiBase(raw: string): string {
  try {
    const url = new URL(raw);
    if (isLoopbackHost(url.hostname)) {
      const hostedProd =
        typeof import.meta !== 'undefined' &&
        Boolean(import.meta.env?.PROD) &&
        typeof window !== 'undefined' &&
        !isLoopbackHost(window.location.hostname);
      // Published Hostinger builds must not call a local API.
      if (hostedProd) return '/api';
    }

    const sameOrigin = typeof window !== 'undefined' && url.origin === window.location.origin;
    if (sameOrigin) {
      return url.pathname.replace(/\/$/, '') === '/api' ? raw.replace(/\/$/, '') : '/api';
    }
    // Electron loopback UI → Hostinger: keep the absolute production URL.
    if (isHostedFrontendOrigin(url.origin)) {
      return ensureApiPath(url, raw);
    }
    if (url.pathname !== '/api' && !url.pathname.endsWith('/api')) {
      return `${raw.replace(/\/$/, '')}/api`;
    }
  } catch {
    /* use raw */
  }
  return raw.replace(/\/$/, '');
}

/**
 * Local web dev goes through the Vite proxy on a relative path; the hosted
 * website uses same-origin `/api`. Packaged Electron must use the public
 * Hostinger API even if preload still exposes relative `/api`.
 */
function resolveApiBaseUrl(): string {
  const envBaseUrl =
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_API_BASE_URL
      : undefined;
  const configured = String(envBaseUrl ?? '').trim().replace(/\/$/, '');

  let desktopUrl = '';
  if (typeof window !== 'undefined') {
    const raw = (window as unknown as { attendanceDesktop?: { apiBaseUrl?: string } }).attendanceDesktop
      ?.apiBaseUrl;
    if (typeof raw === 'string' && raw.trim()) {
      desktopUrl = raw.trim().replace(/\/$/, '');
    }
  }

  const chosen =
    (desktopUrl.startsWith('http') ? desktopUrl : '') ||
    (configured.startsWith('http') ? configured : '') ||
    desktopUrl ||
    configured ||
    '/api';

  if (!chosen || chosen === '/api') {
    const electronProd =
      typeof import.meta !== 'undefined' &&
      import.meta.env?.VITE_IS_ELECTRON === 'true' &&
      Boolean(import.meta.env?.PROD);
    return electronProd ? PRODUCTION_API_BASE_URL : '/api';
  }

  if (chosen.startsWith('http')) return normalizeHttpApiBase(chosen);
  return chosen;
}

export const API_BASE_URL = resolveApiBaseUrl();

if (typeof console !== 'undefined') {
  console.info(`[API] Base URL: ${API_BASE_URL}`);
}

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

const SENSITIVE_QUERY = /token|password|secret|authorization|smtp|otp|code/i;

function sanitizeApiUrl(raw: string): string {
  try {
    const url = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1');
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY.test(key)) url.searchParams.set(key, '[redacted]');
    }
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return raw.split('?')[0] || raw;
  }
}

function getRequestUrl(error: AxiosError): string {
  const cfg = error.config;
  if (!cfg) return API_BASE_URL || '(unknown url)';
  try {
    return sanitizeApiUrl(axios.getUri(cfg));
  } catch {
    const base = String(cfg.baseURL || API_BASE_URL || '');
    const path = String(cfg.url || '');
    return sanitizeApiUrl(`${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
  }
}

function logFailedApiRequest(error: unknown): void {
  if (!axios.isAxiosError(error)) {
    console.error('[API] Request failed:', error instanceof Error ? error.message : error);
    return;
  }
  const method = String(error.config?.method || 'GET').toUpperCase();
  const url = getRequestUrl(error);
  const status = error.response?.status ?? 'NO_RESPONSE';
  const code = error.code || 'ERR';
  console.error(`[API] ${method} ${url} → HTTP ${status} (${code}): ${getReadableApiError(error)}`);
}

apiClient.interceptors.request.use((config) => {
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

const isLocalHost =
  typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);

const UNREACHABLE_MESSAGE =
  API_BASE_URL.startsWith('http') || !isLocalHost
    ? 'Backend server is not reachable.'
    : 'Backend server is not reachable. Start the API with npm run dev:server (port 3001).';

export function getReadableApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const ax = error as AxiosError<unknown>;
    const requestUrl = getRequestUrl(ax);
    if (!ax.response) {
      if (ax.code === 'ECONNABORTED') {
        return `Request timed out waiting for the backend (${requestUrl}).`;
      }
      if (ax.code === 'ERR_NETWORK' || ax.message === 'Network Error') {
        return isLocalHost && !API_BASE_URL.startsWith('http')
          ? `Network error — ${requestUrl} is not reachable. Start the API with npm run dev:server (port 3002).`
          : `Network error — ${requestUrl} is unreachable (no HTTP response).`;
      }
      return `${UNREACHABLE_MESSAGE} (${requestUrl})`;
    }

    const resData: unknown = ax.response.data;
    let serverMessage = '';
    let serverSuccess: boolean | undefined;

    if (typeof resData === 'string') {
      const trimmed = resData.trim();
      if (!trimmed.startsWith('<')) {
        serverMessage = trimmed;
      }
    } else if (typeof resData === 'object' && resData !== null) {
      const obj = resData as Record<string, unknown>;
      if (typeof obj.message === 'string') {
        serverMessage = obj.message;
      } else if (typeof obj.error === 'string') {
        serverMessage = obj.error;
      }
      if (typeof obj.success === 'boolean') {
        serverSuccess = obj.success;
      }
    }

    const status = ax.response.status;
    if (status === 404) {
      return serverMessage || `API route was not found (HTTP 404): ${requestUrl}`;
    }
    if (status === 401) {
      return serverMessage || 'Authentication failed. Please verify your credentials.';
    }
    if (status === 403) {
      return serverMessage || 'Access denied. You do not have permission for this request.';
    }
    if (status === 400) {
      return serverMessage || 'Invalid request parameters.';
    }
    if (status === 405) {
      return serverMessage || `API rejected this request method (HTTP 405): ${requestUrl}`;
    }
    if (status === 502 || status === 503 || status === 504) {
      if (serverMessage && serverSuccess === false) {
        return serverMessage;
      }
      return `Backend service or device is temporarily unavailable (HTTP ${status}): ${requestUrl}`;
    }
    if (status >= 500) {
      if (/database|ECONNREFUSED|postgres/i.test(serverMessage)) {
        return 'Unable to connect to the database.';
      }
      if (/device|isapi|timeout|unreachable/i.test(serverMessage)) {
        return serverMessage || 'Attendance device is unreachable or offline.';
      }
      if (!serverMessage || typeof resData !== 'object') {
        return `${UNREACHABLE_MESSAGE} (HTTP ${status}: ${requestUrl})`;
      }
      return serverMessage || `Server error while processing the request (HTTP ${status}).`;
    }
    return serverMessage || (typeof ax.message === 'string' ? ax.message : '') || `An unexpected API error occurred (HTTP ${status}).`;
  }
  if (error instanceof Error) {
    return error.message && typeof error.message === 'string' && error.message !== '[object Object]'
      ? error.message
      : 'An unexpected error occurred';
  }
  if (typeof error === 'string') return error;
  return 'An unexpected error occurred';
}

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    logFailedApiRequest(error);
    return Promise.reject(new Error(getReadableApiError(error)));
  },
);

export default apiClient;
