import axios, { AxiosError } from 'axios';

/**
 * Shared failure classification for both API clients.
 *
 * The desktop shell talks to two backends — the local Express server for LAN
 * device work, and the hosted Hostinger API for auth and email — so an error
 * has to name which one failed and why. Secrets never appear here: query
 * parameters that look sensitive are redacted before anything is logged.
 */

const SENSITIVE_QUERY = /token|password|secret|authorization|smtp|otp|code/i;

/** Named without values, so a misconfiguration is actionable but not leaky. */
const SMTP_ENV_HINT =
  'The server is missing its email configuration. Set SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS and SMTP_FROM in the hosting environment (Hostinger → Node.js app → Environment variables), then restart the app.';

export function sanitizeApiUrl(raw: string): string {
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

/** True when the message describes a server-side SMTP configuration problem. */
export function isSmtpConfigMessage(message: string): boolean {
  return /SMTP_HOST|SMTP_USER|SMTP_PASS|missing required email environment/i.test(message);
}

/**
 * Turns a raw server-side mail error into guidance aimed at whoever can fix it.
 * Returns null when the message is not about email, so callers can fall back.
 */
export function describeSmtpFailure(message: string): string | null {
  if (isSmtpConfigMessage(message)) return SMTP_ENV_HINT;
  if (/SMTP authentication failure/i.test(message)) {
    return 'The server reached the mail host but the credentials were rejected. Check SMTP_USER and SMTP_PASS on the server.';
  }
  if (/SMTP connection timeout|SMTP connection failed/i.test(message)) {
    return 'The server could not reach the mail host. Check SMTP_HOST, SMTP_PORT and SMTP_SECURE on the server.';
  }
  if (/invalid recipient/i.test(message)) {
    return 'The mail host rejected the recipient address. Check the email address and try again.';
  }
  return null;
}

export interface ApiErrorReporterOptions {
  /** Base URL this client was configured with, used in messages. */
  baseUrl: string;
  /** Human label for the backend, e.g. "local backend" or "online server". */
  label: string;
  /** Extra guidance appended when the backend cannot be reached at all. */
  unreachableHint?: string;
}

export function createApiErrorReporter({ baseUrl, label, unreachableHint }: ApiErrorReporterOptions) {
  const isAbsolute = baseUrl.startsWith('http');
  const hint = unreachableHint ? ` ${unreachableHint}` : '';

  function getRequestUrl(error: AxiosError): string {
    const cfg = error.config;
    if (!cfg) return baseUrl || '(unknown url)';
    try {
      return sanitizeApiUrl(axios.getUri(cfg));
    } catch {
      const base = String(cfg.baseURL || baseUrl || '');
      const path = String(cfg.url || '');
      return sanitizeApiUrl(`${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
    }
  }

  /**
   * A browser reports a blocked cross-origin response and a dead host
   * identically (`ERR_NETWORK`, status 0). Distinguish them by whether the
   * request was cross-origin in the first place.
   */
  function isCrossOrigin(): boolean {
    if (!isAbsolute || typeof window === 'undefined') return false;
    try {
      return new URL(baseUrl).origin !== window.location.origin;
    } catch {
      return false;
    }
  }

  function describeNoResponse(ax: AxiosError, requestUrl: string): string {
    if (ax.code === 'ECONNABORTED') {
      return `Request timed out waiting for the ${label} (${requestUrl}). The server may be slow or offline.`;
    }
    if (ax.code === 'ERR_INVALID_URL') {
      return `The API address is not a valid URL (${baseUrl}). Fix the configured API base URL and restart the app.`;
    }
    if (ax.code === 'ERR_BAD_REQUEST' && !ax.response) {
      return `The ${label} rejected the request before responding (${requestUrl}).`;
    }
    if (ax.code === 'ERR_NETWORK' || ax.message === 'Network Error') {
      if (isCrossOrigin()) {
        return `Could not reach the ${label} at ${requestUrl}. This is either no internet connection, the server being offline, or the server refusing this app's origin (CORS). Confirm the server is running and that CORS_ORIGINS on the server allows this app.${hint}`;
      }
      return `Network error — ${requestUrl} is unreachable (no HTTP response).${hint}`;
    }
    return `The ${label} is not reachable (${requestUrl}).${hint}`;
  }

  function getReadableApiError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const ax = error as AxiosError<unknown>;
      const requestUrl = getRequestUrl(ax);

      if (!ax.response) return describeNoResponse(ax, requestUrl);

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

      const smtp = serverMessage ? describeSmtpFailure(serverMessage) : null;
      if (smtp) return smtp;

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
      if (status === 429) {
        return serverMessage || 'Too many requests. Please wait a moment and try again.';
      }
      if (status === 502 || status === 503 || status === 504) {
        if (serverMessage && serverSuccess === false) {
          return serverMessage;
        }
        return `The ${label} is temporarily unavailable (HTTP ${status}): ${requestUrl}`;
      }
      if (status >= 500) {
        if (/database|ECONNREFUSED|postgres|mysql/i.test(serverMessage)) {
          return 'Unable to connect to the database.';
        }
        if (/device|isapi|timeout|unreachable/i.test(serverMessage)) {
          return serverMessage || 'Attendance device is unreachable or offline.';
        }
        if (!serverMessage || typeof resData !== 'object') {
          return `The ${label} returned an error (HTTP ${status}: ${requestUrl}).${hint}`;
        }
        return serverMessage || `Server error while processing the request (HTTP ${status}).`;
      }
      return (
        serverMessage ||
        (typeof ax.message === 'string' ? ax.message : '') ||
        `An unexpected API error occurred (HTTP ${status}).`
      );
    }
    if (error instanceof Error) {
      return error.message && typeof error.message === 'string' && error.message !== '[object Object]'
        ? error.message
        : 'An unexpected error occurred';
    }
    if (typeof error === 'string') return error;
    return 'An unexpected error occurred';
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

  return { getReadableApiError, logFailedApiRequest, getRequestUrl };
}
