import axios, { AxiosError } from 'axios';

/**
 * Local dev goes through the Vite proxy on a relative path; the hosted build
 * is served from a different domain than the API, so it needs an absolute URL
 * supplied at build time via VITE_API_BASE_URL.
 */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

const UNREACHABLE_MESSAGE = API_BASE_URL.startsWith('http')
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
