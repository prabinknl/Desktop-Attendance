/**
 * Public Hostinger endpoints for the packaged desktop app.
 *
 * Nothing here is a secret: only the public origin and API path live in the
 * bundle. SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS /
 * SMTP_FROM are read exclusively by the hosted Node backend from its own
 * process environment and must never be exposed as VITE_* variables.
 */

/** Public Hostinger origin used by the published website. Not a secret. */
export const PRODUCTION_APP_ORIGIN = 'https://desktop-attendance.appnep.com';

/** Fallback used when no build-time override is supplied. Not a secret. */
export const DEFAULT_PRODUCTION_API_BASE_URL = `${PRODUCTION_APP_ORIGIN}/api`;

/**
 * Rejects anything that is not an absolute http(s) URL, and refuses loopback
 * hosts so a stray dev value can never ship inside an installer.
 */
export function isUsableProductionApiUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i.test(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Appends `/api` unless the configured URL already ends with it. */
export function normalizeProductionApiUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_PRODUCTION_API_BASE_URL;
  const url = new URL(trimmed);
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '/api' || path.endsWith('/api')) return trimmed;
  return `${trimmed}/api`;
}

/**
 * Build-time override so a different deployment can be targeted without a code
 * change. Falls back to the known production API when unset or unusable.
 */
export function resolveProductionApiBaseUrl(): string {
  const configured =
    typeof import.meta !== 'undefined' && import.meta.env
      ? String(import.meta.env.VITE_CLOUD_API_BASE_URL ?? '').trim()
      : '';

  if (!configured) return DEFAULT_PRODUCTION_API_BASE_URL;
  if (!isUsableProductionApiUrl(configured)) {
    console.warn(
      `[API] Ignoring unusable VITE_CLOUD_API_BASE_URL — falling back to ${DEFAULT_PRODUCTION_API_BASE_URL}`,
    );
    return DEFAULT_PRODUCTION_API_BASE_URL;
  }
  return normalizeProductionApiUrl(configured);
}

/** Public Hostinger API used by the published website and packaged Electron. Not a secret. */
export const PRODUCTION_API_BASE_URL = resolveProductionApiBaseUrl();
