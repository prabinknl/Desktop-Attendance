import axios, { AxiosError } from 'axios';

function isHostedFrontendOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname.endsWith('.insforge.site') ||
      hostname.endsWith('.vercel.app') ||
      hostname.endsWith('.appnep.com') ||
      hostname === 'desktop-attendance.appnep.com' ||
      hostname === 'attendance.appnep.com'
    );
  } catch {
    return false;
  }
}

/**
 * Local web dev goes through the Vite proxy on a relative path; the hosted
 * build needs VITE_API_BASE_URL pointing at the Express API (…/api). The
 * Electron shell exposes a loopback API URL via preload.
 *
 * If VITE_API_BASE_URL was set to the frontend host by mistake (for example
 * https://ahu7znxh.insforge.site), use same-origin /api so Vercel can serve
 * the Express handler.
 */
function resolveApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const desktopUrl = (window as unknown as { attendanceDesktop?: { apiBaseUrl?: string } }).attendanceDesktop?.apiBaseUrl;
    if (typeof desktopUrl === 'string' && desktopUrl.trim()) {
      return desktopUrl.replace(/\/$/, '');
    }
  }

  const envBaseUrl =
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_API_BASE_URL
      : (typeof process !== 'undefined' ? process.env?.VITE_API_BASE_URL : undefined);
  const configured = String(envBaseUrl ?? '').trim().replace(/\/$/, '');
  if (!configured || configured === '/api') return '/api';

  if (configured.startsWith('http')) {
    try {
      const url = new URL(configured);
      const sameOrigin = typeof window !== 'undefined' && url.origin === window.location.origin;
      if (sameOrigin || isHostedFrontendOrigin(url.origin)) {
        return url.pathname.replace(/\/$/, '') === '/api' ? configured : '/api';
      }
      if (url.pathname !== '/api' && !url.pathname.endsWith('/api')) {
        return `${configured}/api`;
      }
    } catch {
      /* use configured */
    }
  }
  return configured;
}

export const API_BASE_URL = resolveApiBaseUrl();

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

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
    const ax = error as AxiosError<{ message?: string; success?: boolean; error?: string }>;
    if (!ax.response) {
      if (ax.code === 'ECONNABORTED') return 'Request timed out waiting for the backend.';
      if (ax.code === 'ERR_NETWORK' || ax.message === 'Network Error') {
        return isLocalHost
          ? 'Network error — Backend server is not reachable. Start the API with npm run dev:server (port 3001).'
          : 'Network error — Backend server is unreachable. Please check your internet connection or deployment status.';
      }
      return UNREACHABLE_MESSAGE;
    }

    const resData = ax.response.data;
    let serverMessage = '';
    if (typeof resData === 'string') {
      if (!resData.trim().startsWith('<')) {
        serverMessage = resData.trim();
      }
    } else if (typeof resData === 'object' && resData !== null) {
      if (typeof resData.message === 'string') {
        serverMessage = resData.message;
      } else if (typeof resData.error === 'string') {
        serverMessage = resData.error;
      }
    }

    if (ax.response.status === 404) {
      return serverMessage || 'API route was not found (HTTP 404).';
    }
    if (ax.response.status === 401) {
      return serverMessage || 'Authentication failed. Please verify your credentials.';
    }
    if (ax.response.status === 403) {
      return serverMessage || 'Access denied. You do not have permission for this request.';
    }
    if (ax.response.status === 400) {
      return serverMessage || 'Invalid request parameters.';
    }
    if (ax.response.status === 405) {
      return serverMessage || (API_BASE_URL.startsWith('http')
        ? 'API rejected this request method (HTTP 405).'
        : 'Backend API route does not accept this request method (HTTP 405).');
    }
    if (ax.response.status === 502 || ax.response.status === 503 || ax.response.status === 504) {
      if (serverMessage && resData && typeof resData === 'object' && resData.success === false) {
        return serverMessage;
      }
      return 'Backend service or device is temporarily unavailable (HTTP ' + ax.response.status + ').';
    }
    if (ax.response.status >= 500) {
      if (/database|ECONNREFUSED|postgres/i.test(serverMessage)) {
        return 'Unable to connect to the database.';
      }
      if (/device|isapi|timeout|unreachable/i.test(serverMessage)) {
        return serverMessage || 'Attendance device is unreachable or offline.';
      }
      if (!serverMessage || typeof resData !== 'object') {
        return UNREACHABLE_MESSAGE;
      }
      return serverMessage || 'Server error while processing the request.';
    }
    return serverMessage || (typeof ax.message === 'string' ? ax.message : '') || 'An unexpected API error occurred.';
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
  (error) => Promise.reject(new Error(getReadableApiError(error))),
);

export default apiClient;
