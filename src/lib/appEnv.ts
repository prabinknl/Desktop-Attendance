/**
 * Build-target helpers shared by the router and by link generation.
 *
 * The desktop bundle is served from a loopback origin with relative asset URLs
 * (`base: './'` in vite.config.electron.ts), so a path like /invite/<token>
 * would resolve assets against /invite/ and fail. Hash routing keeps the path
 * at "/" for every route. VITE_IS_ELECTRON is defined only by the Electron
 * build, so the same bundle uses hash routes whether it is opened inside the
 * Electron window or in an external browser.
 */
export const isDesktopBuild =
  import.meta.env.VITE_IS_ELECTRON === 'true' ||
  (typeof window !== 'undefined' && Boolean(window.attendanceDesktop?.isElectron));

/** Absolute URL for a route, using the form the running bundle can load. */
export function buildAppUrl(routePath: string): string {
  const path = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const origin = window.location.origin.replace(/\/+$/, '');
  return isDesktopBuild ? `${origin}/#${path}` : `${origin}${path}`;
}
