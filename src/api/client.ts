import axios, { AxiosError } from 'axios';

function isHostedFrontendOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname.endsWith('.insforge.site') || hostname.endsWith('.vercel.app');
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
  const desktopUrl = window.attendanceDesktop?.apiBaseUrl;
  if (typeof desktopUrl === 'string' && desktopUrl.trim()) {
    return desktopUrl.replace(/\/$/, '');
  }

  const configured = String(import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (!configured || configured === '/api') return '/api';

  if (configured.startsWith('http')) {
    try {
      const url = new URL(configured);
      const sameOrigin = url.origin === window.location.origin;
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
    const raw = localStorage.getItem('ams_user');
    if (raw) {
      const user = JSON.parse(raw);
      if (user?.role) config.headers['x-user-role'] = user.role;
      if (user?.id) config.headers['x-user-id'] = user.id;
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
    const ax = error as AxiosError<{ message?: string; success?: boolean }>;
    if (!ax.response) {
      if (ax.code === 'ECONNABORTED') return 'Request timed out waiting for the backend.';
      return UNREACHABLE_MESSAGE;
    }
    if (ax.response.status === 404) return 'Device settings API was not found.';
    if (ax.response.status === 405) {
      return API_BASE_URL.startsWith('http')
        ? 'API rejected this request (HTTP 405).'
        : 'Backend API URL is not configured for this host. Set VITE_API_BASE_URL to your compute API (…/api) and redeploy.';
    }
    if (ax.response.status === 400) {
      return ax.response.data?.message ?? 'Device settings are invalid.';
    }
    // 502 from our API includes { success, message }; Vite proxy 502s do not
    if (ax.response.status === 502) {
      const msg = ax.response.data?.message;
      if (msg && ax.response.data?.success === false) {
        return msg;
      }
      return UNREACHABLE_MESSAGE;
    }
    if (ax.response.status >= 500) {
      const msg = ax.response.data?.message ?? '';
      if (/database|ECONNREFUSED|postgres/i.test(msg)) {
        return 'Unable to connect to the database.';
      }
      // Empty/HTML bodies usually mean the Vite proxy could not reach port 3001
      if (!msg || typeof ax.response.data !== 'object') {
        return UNREACHABLE_MESSAGE;
      }
      return msg || 'Server error while processing the request.';
    }
    return ax.response.data?.message ?? ax.message;
  }
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred';
}

apiClient.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(new Error(getReadableApiError(error))),
);

export default apiClient;
