/**
 * Background auto-update against GitHub Releases (electron-updater).
 *
 * - Checks shortly after startup, every CHECK_INTERVAL_MS, and after resume.
 * - Downloads in the background; progress and status are pushed to the renderer
 *   and kept in `state` so a window that loads later can read them.
 * - Once downloaded, offers "Restart and Update" / "Later". Later installs on
 *   the next normal quit (autoInstallOnAppQuit).
 * - Network failures and missing releases are recorded and retried on the next
 *   scheduled check; they never block the app.
 */
'use strict';

const { app, dialog, powerMonitor } = require('electron');
const { autoUpdater } = require('electron-updater');

const STARTUP_DELAY_MS = 8_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RESUME_MIN_GAP_MS = 30 * 60 * 1000;

const OFFLINE_PATTERN =
  /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|CONNECTION_(REFUSED|RESET|TIMED_OUT|CLOSED)|ADDRESS_UNREACHABLE|TIMED_OUT|PROXY)/i;
const NOT_PUBLISHED_PATTERN =
  /HttpError: 404|status 404|Cannot find latest\.yml|Unable to find latest version|No published versions|latest\.yml in the latest release/i;

function redact(text) {
  return String(text ?? '')
    .replace(/(gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/(authorization|token)(["'\s:=]+)[^\s"',]+/gi, '$1$2[redacted]');
}

function classifyError(err) {
  const raw = redact(err instanceof Error ? err.message : String(err));
  if (OFFLINE_PATTERN.test(raw)) {
    return {
      errorKind: 'offline',
      error: 'Could not reach the update server. The app will try again later.',
      detail: raw.slice(0, 300),
    };
  }
  if (NOT_PUBLISHED_PATTERN.test(raw)) {
    return {
      errorKind: 'not-published',
      error: 'No update information is published for this app yet.',
      detail: raw.slice(0, 300),
    };
  }
  return { errorKind: 'other', error: 'Update check failed. The app will try again later.', detail: raw.slice(0, 300) };
}

/**
 * @param {object} opts
 * @param {(msg: string) => void} opts.log
 * @param {() => import('electron').BrowserWindow | null} opts.getWindow
 * @param {() => Promise<void>} opts.prepareForInstall Stops background work safely before the installer runs.
 */
function createUpdater({ log, getWindow, prepareForInstall }) {
  /** @type {Record<string, unknown>} */
  let state = { status: 'idle', currentVersion: app.getVersion() };
  let started = false;
  let checking = false;
  let installing = false;
  let lastCheckAt = 0;
  /** @type {NodeJS.Timeout | null} */
  let intervalTimer = null;
  /** @type {string | null} */
  let promptedVersion = null;

  const enabled = app.isPackaged;

  function setState(patch) {
    state = { ...state, ...patch, currentVersion: app.getVersion(), updatedAt: new Date().toISOString() };
    const { detail: _detail, ...forLog } = state;
    if (patch.status !== 'download-progress') {
      log(`[AutoUpdater] ${String(state.status)} ${JSON.stringify(forLog)}`);
    }
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater:status', state);
    }
  }

  function isBusy() {
    return (
      checking ||
      installing ||
      state.status === 'download-progress' ||
      state.status === 'update-available' ||
      state.status === 'update-downloaded'
    );
  }

  async function check(reason) {
    if (!enabled) return { ...state, status: 'dev-mode' };
    if (isBusy()) return state;
    checking = true;
    lastCheckAt = Date.now();
    log(`[AutoUpdater] Checking GitHub Releases (${reason}, current version ${app.getVersion()})`);
    try {
      const result = await autoUpdater.checkForUpdates();
      // Download failures surface through the 'error' event; keep the promise handled.
      result?.downloadPromise?.catch(() => undefined);
    } catch (err) {
      setState({ status: 'error', ...classifyError(err) });
    } finally {
      checking = false;
    }
    return state;
  }

  async function promptInstall(version) {
    if (!version || promptedVersion === version || installing) return;
    promptedVersion = version;
    const win = getWindow();
    const options = {
      type: 'info',
      title: 'Update ready',
      message: `Attendance Desktop ${version} has been downloaded.`,
      detail:
        'Restart now to install it. Attendance sync in progress will finish first; save any open forms before restarting.\n\n' +
        'Choose Later to keep working. The update installs automatically the next time you close the app.',
      buttons: ['Restart and Update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    try {
      const { response } =
        win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
      if (response === 0) {
        log('[AutoUpdater] User chose Restart and Update');
        await restartAndInstall();
      } else {
        log('[AutoUpdater] User chose Later - update will install on next quit');
      }
    } catch (err) {
      log(`[AutoUpdater] Prompt failed: ${redact(err instanceof Error ? err.message : String(err))}`);
    }
  }

  async function restartAndInstall() {
    if (!enabled) return { status: 'dev-mode' };
    if (state.status !== 'update-downloaded') return { status: String(state.status) };
    if (installing) return { status: 'installing' };
    installing = true;
    setState({ status: 'installing' });
    try {
      await prepareForInstall();
    } catch (err) {
      log(`[AutoUpdater] Pre-install shutdown issue: ${redact(err instanceof Error ? err.message : String(err))}`);
    }
    try {
      // Silent per-user install, then relaunch the updated app.
      autoUpdater.quitAndInstall(true, true);
      return { status: 'installing' };
    } catch (err) {
      log(`[AutoUpdater] quitAndInstall failed: ${redact(err instanceof Error ? err.message : String(err))}`);
      // autoInstallOnAppQuit still applies the downloaded update on this quit.
      app.quit();
      return { status: 'installing' };
    }
  }

  function start() {
    if (started) return;
    started = true;
    if (!enabled) {
      log('[AutoUpdater] Disabled (app is not packaged)');
      return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = {
      info: (m) => log(`[electron-updater] ${redact(m)}`),
      warn: (m) => log(`[electron-updater] WARN ${redact(m)}`),
      error: (m) => log(`[electron-updater] ERROR ${redact(m)}`),
      debug: () => undefined,
    };

    autoUpdater.on('checking-for-update', () => setState({ status: 'checking-for-update', error: undefined }));
    autoUpdater.on('update-available', (info) =>
      setState({
        status: 'update-available',
        version: info?.version,
        releaseDate: info?.releaseDate,
        percent: 0,
        error: undefined,
      }),
    );
    autoUpdater.on('update-not-available', (info) =>
      setState({
        status: 'update-not-available',
        latestVersion: info?.version,
        version: undefined,
        checkedAt: new Date().toISOString(),
        error: undefined,
      }),
    );
    autoUpdater.on('download-progress', (p) =>
      setState({
        status: 'download-progress',
        percent: p?.percent,
        transferred: p?.transferred,
        total: p?.total,
        bytesPerSecond: p?.bytesPerSecond,
      }),
    );
    autoUpdater.on('update-downloaded', (info) => {
      setState({ status: 'update-downloaded', version: info?.version, releaseDate: info?.releaseDate, percent: 100 });
      void promptInstall(info?.version);
    });
    autoUpdater.on('error', (err) => {
      if (installing) return;
      setState({ status: 'error', ...classifyError(err) });
    });

    setTimeout(() => void check('startup'), STARTUP_DELAY_MS);
    intervalTimer = setInterval(() => void check('scheduled'), CHECK_INTERVAL_MS);
    powerMonitor.on('resume', () => {
      if (Date.now() - lastCheckAt >= RESUME_MIN_GAP_MS) void check('resume');
    });
  }

  function stop() {
    if (intervalTimer) clearInterval(intervalTimer);
    intervalTimer = null;
  }

  return {
    start,
    stop,
    check: () => check('manual'),
    restartAndInstall,
    getState: () => (enabled ? state : { ...state, status: 'dev-mode' }),
    isInstalling: () => installing,
  };
}

module.exports = { createUpdater, classifyError };
