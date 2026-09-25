import axios from 'axios';
import { createApiErrorReporter } from './apiErrors';

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
 * website uses its configured API or same-origin `/api`. Electron uses the
 * backend selected by preload, including a relative path to its local server.
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

  const isElectron =
    import.meta.env?.VITE_IS_ELECTRON === 'true' ||
    (typeof window !== 'undefined' && window.attendanceDesktop?.isElectron);
  // Runtime desktop settings take precedence over hosted build settings.
  // Relative /api also follows the actual loopback port chosen at startup.
  const chosen = desktopUrl || (isElectron ? '/api' : configured) || '/api';

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

const { getReadableApiError, logFailedApiRequest } = createApiErrorReporter({
  baseUrl: API_BASE_URL,
  label: 'local backend',
  unreachableHint:
    isLocalHost && !API_BASE_URL.startsWith('http')
      ? 'Start the API with npm run dev:server (port 3002).'
      : undefined,
});

export { getReadableApiError };

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    logFailedApiRequest(error);
    return Promise.reject(new Error(getReadableApiError(error)));
  },
);

export default apiClient;
