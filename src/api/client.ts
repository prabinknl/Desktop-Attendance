import axios, { AxiosError } from 'axios';

const apiClient = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

export function getReadableApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const ax = error as AxiosError<{ message?: string; success?: boolean }>;
    if (!ax.response) {
      if (ax.code === 'ECONNABORTED') return 'Request timed out waiting for the backend.';
      return 'Backend server is not reachable. Start the API with npm run dev:server (port 3001).';
    }
    if (ax.response.status === 404) return 'Device settings API was not found.';
    if (ax.response.status === 400) {
      return ax.response.data?.message ?? 'Device settings are invalid.';
    }
    // 502 from our API includes { success, message }; Vite proxy 502s do not
    if (ax.response.status === 502) {
      const msg = ax.response.data?.message;
      if (msg && ax.response.data?.success === false) {
        return msg;
      }
      return 'Backend server is not reachable. Start the API with npm run dev:server (port 3001).';
    }
    if (ax.response.status >= 500) {
      const msg = ax.response.data?.message ?? '';
      if (/database|ECONNREFUSED|postgres/i.test(msg)) {
        return 'Unable to connect to the database.';
      }
      // Empty/HTML bodies usually mean the Vite proxy could not reach port 3001
      if (!msg || typeof ax.response.data !== 'object') {
        return 'Backend server is not reachable. Start the API with npm run dev:server (port 3001).';
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
