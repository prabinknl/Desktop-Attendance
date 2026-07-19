import app from './app.js';
import { env } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { setMemoryMode } from './models/DeviceModel.js';
import { refreshSyncScheduler, startSyncSettingsWatcher } from './services/device/BackgroundSyncService.js';

async function start() {
  try {
    await runMigrations();
    console.log('[Server] Database migrations applied');
  } catch (err) {
    setMemoryMode(true);
    console.warn('[Server] Database unavailable — using in-memory store:', err instanceof Error ? err.message : err);
    console.warn('[Server] Configure DATABASE_URL in server/.env for persistent storage.');
  }

  await refreshSyncScheduler();
  startSyncSettingsWatcher();

  app.listen(env.port, () => {
    console.log(`[Server] API listening on http://localhost:${env.port}`);
    console.log('[Server] Hikvision ISAPI mode: REAL (mock disabled)');
  });
}

start().catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
