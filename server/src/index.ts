import app from './app.js';
import { env, logStartupEnvironment, validateStartupEnvironment } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { getPoolDriver } from './db/pool.js';
import { isExplicitMemoryStore, isMemoryMode, setMemoryMode } from './models/DeviceModel.js';
import type { Server } from 'http';
import {
  refreshSyncScheduler,
  startSyncSettingsWatcher,
  stopSyncScheduler,
} from './services/device/BackgroundSyncService.js';
import {
  autoReconnectDevice,
  handleSystemResume,
  handleSystemSuspend,
  stopAutoReconnectWatcher,
  tryReconnectOnce,
} from './services/device/AutoReconnectService.js';
import { waitForSyncIdle } from './services/device/SyncService.js';
import { getInsForgeStatus } from './services/insforge/insforgeClient.js';

const DB_BOOT_TIMEOUT_MS = 10_000;
const SHUTDOWN_SYNC_WAIT_MS = 15_000;

let httpServer: Server | null = null;
let shuttingDown = false;

/** Stop scheduling work, let an in-progress attendance sync finish, then exit. */
async function gracefulShutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] Shutting down (${reason})`);
  stopAutoReconnectWatcher();
  stopSyncScheduler();
  const idle = await waitForSyncIdle(SHUTDOWN_SYNC_WAIT_MS);
  if (!idle) console.warn('[Server] Attendance sync still running at shutdown; unsynced punches remain on the machine and download next time');
  httpServer?.close();
  process.exit(0);
}

// Messages from the Electron main process (IPC channel exists only when spawned by the desktop app).
process.on('message', (message: unknown) => {
  const type = (message as { type?: string } | null)?.type;
  if (type === 'shutdown') void gracefulShutdown((message as { reason?: string }).reason ?? 'desktop');
  else if (type === 'system-suspend') handleSystemSuspend();
  else if (type === 'system-resume') handleSystemResume();
});
process.on('disconnect', () => void gracefulShutdown('desktop app closed'));

function dbLabel(): string {
  return getPoolDriver() === 'mysql' ? 'MySQL/MariaDB' : 'PostgreSQL';
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function prepareDatabase(): Promise<void> {
  if ((process.env.USE_MEMORY_STORE ?? '').toLowerCase() === 'true') {
    setMemoryMode(true);
    console.log(`[Server] USE_MEMORY_STORE=true — skipping ${dbLabel()}`);
    return;
  }

  try {
    await withTimeout(runMigrations(), DB_BOOT_TIMEOUT_MS, 'Database migrations');
    console.log(`[Server] ${dbLabel()} migrations applied`);
  } catch (err) {
    setMemoryMode(true);
    console.warn(
      `[Server] ${dbLabel()} unavailable — using in-memory store:`,
      err instanceof Error ? err.message : err,
    );
    console.warn(
      '[Server] Configure DB_HOST/DB_NAME/DB_USER (MySQL) or DATABASE_URL (legacy Postgres) in server/.env for persistent storage.',
    );
  }
}

async function recoverDatabase(): Promise<boolean> {
  if (isExplicitMemoryStore()) return false;
  try {
    await withTimeout(runMigrations(), DB_BOOT_TIMEOUT_MS, 'Database recovery');
    setMemoryMode(false);
    console.log(`[Server] ${dbLabel()} recovered — retrying device auto-connect`);
    return true;
  } catch {
    return false;
  }
}

function startDatabaseRecoveryWatcher(): void {
  if (isExplicitMemoryStore()) return;
  if (!isMemoryMode()) return;

  const delays = [5_000, 15_000, 30_000];
  let attempt = 0;

  const tick = async () => {
    if (!isMemoryMode() || isExplicitMemoryStore()) return;
    const ok = await recoverDatabase();
    if (ok) {
      const outcome = await tryReconnectOnce().catch(() => null);
      if (outcome?.connected) {
        console.log(
          `[Device] Auto-reconnected after database recovery: ${outcome.ipAddress}:${outcome.port}`,
        );
      }
      return;
    }
    attempt += 1;
    const wait = delays[Math.min(attempt, delays.length - 1)] ?? 60_000;
    setTimeout(() => void tick(), attempt < delays.length ? wait : 60_000);
  };

  setTimeout(() => void tick(), delays[0]);
}

async function start() {
  // Bind the HTTP port first so Electron's health check does not time out
  // while the database / legacy InsForge probe are still connecting.
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(env.port, env.host, () => {
      httpServer = server;
      console.log(`[Server] API listening on http://${env.host}:${env.port}`);
      console.log(`[Server] Database driver: ${dbLabel()}`);
      logStartupEnvironment();
      // Names only — never values. Exits here when STRICT_ENV_VALIDATION=true.
      validateStartupEnvironment();
      resolve();
    });
    server.once('error', reject);
  });

  await prepareDatabase();

  console.log(`[Server] Device sync: ${env.deviceSyncEnabled ? 'REAL Hikvision ISAPI' : 'disabled'}`);

  if (env.deviceSyncEnabled) {
    await refreshSyncScheduler().catch((err) => {
      console.warn('[Server] Sync scheduler init failed:', err instanceof Error ? err.message : err);
    });
    startSyncSettingsWatcher();
    void autoReconnectDevice();
    startDatabaseRecoveryWatcher();
  } else {
    console.log('[Server] Device sync disabled — the attendance machine is LAN-only');
  }

  // Legacy InsForge status probe — optional during Hostinger MySQL migration.
  void getInsForgeStatus()
    .then((insforgeStatus) => {
      console.log(
        `[Server] InsForge BaaS (legacy): ${insforgeStatus.connected ? 'Connected' : 'Not Connected'} (${insforgeStatus.message})`,
      );
    })
    .catch((err) => {
      console.warn('[Server] InsForge status check failed:', err instanceof Error ? err.message : err);
    });
}

start().catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
