/**
 * App version helpers.
 *
 * Packaged Electron: prefer `app.getVersion()` via the secure preload bridge
 * (`window.attendanceDesktop.getAppVersion`) so the UI always matches the
 * installed binary.
 *
 * Web / unpackaged dev: fall back to `__APP_VERSION__`, stamped from
 * package.json at Vite build time (same field electron-builder uses).
 */

export const FALLBACK_APP_VERSION: string = __APP_VERSION__;

/** @deprecated Use FALLBACK_APP_VERSION or resolveAppVersion() */
export const APP_VERSION: string = FALLBACK_APP_VERSION;

export async function resolveAppVersion(): Promise<string> {
  try {
    const fromElectron = await window.attendanceDesktop?.getAppVersion?.();
    if (typeof fromElectron === 'string' && fromElectron.trim()) {
      return fromElectron.trim();
    }
  } catch {
    /* ignore — fall through to build-time version */
  }
  return FALLBACK_APP_VERSION;
}
