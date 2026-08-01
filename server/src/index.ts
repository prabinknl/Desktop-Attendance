import app from './app.js';
import { env } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { setMemoryMode } from './models/DeviceModel.js';
import { refreshSyncScheduler, startSyncSettingsWatcher } from './services/device/BackgroundSyncService.js';
import { autoReconnectDevice } from './services/device/AutoReconnectService.js';
import { getInsForgeStatus } from './services/insforge/insforgeClient.js';

async function start() {
  try {
    await runMigrations();
    console.log('[Server] Database migrations applied');
  } catch (err) {
    setMemoryMode(true);
    console.warn('[Server] Database unavailable — using in-memory store:', err instanceof Error ? err.message : err);
    console.warn('[Server] Configure DATABASE_URL in server/.env for persistent storage.');
  }

  if (env.deviceSyncEnabled) {
    await refreshSyncScheduler();
    startSyncSettingsWatcher();

    // Auto-reconnect saved attendance machine on startup (if network-reachable)
    autoReconnectDevice();
  } else {
    console.log('[Server] Device sync disabled — the attendance machine is LAN-only');
  }

  const insforgeStatus = await getInsForgeStatus();

  app.listen(env.port, () => {
    console.log(`[Server] API listening on port ${env.port}`);
    console.log(`[Server] Device sync: ${env.deviceSyncEnabled ? 'REAL Hikvision ISAPI' : 'disabled'}`);
    console.log(`[Server] InsForge BaaS: ${insforgeStatus.connected ? 'Connected' : 'Not Connected'} (${insforgeStatus.message})`);
  });
}

start().catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
