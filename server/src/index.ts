import app from './app.js';
import { env } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { setMemoryMode } from './models/DeviceModel.js';
import { refreshSyncScheduler, startSyncSettingsWatcher } from './services/device/BackgroundSyncService.js';
import { autoReconnectDevice } from './services/device/AutoReconnectService.js';
import { getInsForgeStatus } from './services/insforge/insforgeClient.js';

const DB_BOOT_TIMEOUT_MS = 10_000;

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
    console.log('[Server] USE_MEMORY_STORE=true — skipping PostgreSQL');
    return;
  }

  try {
    await withTimeout(runMigrations(), DB_BOOT_TIMEOUT_MS, 'Database migrations');
    console.log('[Server] Database migrations applied');
  } catch (err) {
    setMemoryMode(true);
    console.warn(
      '[Server] Database unavailable — using in-memory store:',
      err instanceof Error ? err.message : err,
    );
    console.warn('[Server] Configure DATABASE_URL in server/.env for persistent storage.');
  }
}

async function start() {
  // Bind the HTTP port first so Electron's health check does not time out
  // while PostgreSQL / InsForge are still connecting.
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(env.port, () => {
      console.log(`[Server] API listening on port ${env.port}`);
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
  } else {
    console.log('[Server] Device sync disabled — the attendance machine is LAN-only');
  }

  void getInsForgeStatus()
    .then((insforgeStatus) => {
      console.log(
        `[Server] InsForge BaaS: ${insforgeStatus.connected ? 'Connected' : 'Not Connected'} (${insforgeStatus.message})`,
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
