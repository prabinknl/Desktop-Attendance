import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/src/config → server/.env (primary), then repo-root .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const DEFAULT_CORS_ORIGINS = ['http://localhost:3002', 'http://127.0.0.1:3002'];

/**
 * Browser origins allowed to call this API. The hosted frontend runs on a
 * different domain than local dev, so CORS_ORIGINS (comma-separated) must list
 * it when the server runs in the cloud.
 */
function parseCorsOrigins(): string[] | boolean {
  const raw = (process.env.CORS_ORIGINS ?? '').trim();
  if (!raw) return DEFAULT_CORS_ORIGINS;
  if (raw === '*') return true;
  const origins = raw.split(',').map((o) => o.trim()).filter(Boolean);
  return origins.length > 0 ? [...new Set([...DEFAULT_CORS_ORIGINS, ...origins])] : DEFAULT_CORS_ORIGINS;
}

export const env = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  corsOrigins: parseCorsOrigins(),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/attendance_db',
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  /**
   * Mock mode is disabled. Real Hikvision ISAPI is always used.
   * DEVICE_MOCK_MODE is ignored if set — kept only so old .env files do not break boot.
   */
  deviceMockMode: false,
  /**
   * Background device polling and auto-reconnect. The attendance machine is
   * only reachable from the office LAN, so a cloud-hosted instance must run
   * with DEVICE_SYNC_ENABLED=false to avoid pointless scans and reconnects.
   */
  deviceSyncEnabled: (process.env.DEVICE_SYNC_ENABLED ?? 'true').toLowerCase() !== 'false',
  /** Legacy shared secret; prefer per-device connector_token_hash when set. */
  gatewaySecret: (process.env.GATEWAY_SECRET ?? '').trim(),
  /** Expected connector heartbeat interval (seconds). */
  connectorHeartbeatSeconds: Math.max(15, parseInt(process.env.CONNECTOR_HEARTBEAT_SECONDS ?? '30', 10)),
  adminSignupEmail: (process.env.ADMIN_SIGNUP_EMAIL ?? 'appnep@pacenp.com').trim().toLowerCase(),
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: parseInt(process.env.SMTP_PORT ?? '587', 10),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  smtpFrom: process.env.SMTP_FROM ?? '',
};
