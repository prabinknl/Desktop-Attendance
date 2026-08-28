import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

try {
  const envDir = path.dirname(fileURLToPath(import.meta.url));
  // Hostinger (and other Node hosts) inject process.env; local .env files are optional.
  dotenv.config({ path: path.resolve(envDir, '../../.env') });
  dotenv.config({ path: path.resolve(envDir, '../../../.env') });
} catch {
  dotenv.config();
}

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
  'https://desktop-attendance.appnep.com',
  'https://ahu7znxh.insforge.site',
  'https://attendance.appnep.com',
];

/**
 * Browser origins allowed to call this API. The hosted frontend runs on a
 * different domain than local dev, so CORS_ORIGINS (comma-separated) must list
 * it when the server runs in the cloud.
 */
function parseCorsOrigins(): string[] | boolean {
  // Electron loads the UI from file:// (Origin: null) and calls the local API.
  if ((process.env.ELECTRON_DESKTOP ?? '').trim() === '1') {
    return true;
  }
  const raw = (process.env.CORS_ORIGINS ?? '').trim();
  if (!raw) return DEFAULT_CORS_ORIGINS;
  if (raw === '*') return true;
  const origins = raw.split(',').map((o) => o.trim()).filter(Boolean);
  return origins.length > 0 ? [...new Set([...DEFAULT_CORS_ORIGINS, ...origins])] : DEFAULT_CORS_ORIGINS;
}

function getAppPublicUrl(): string {
  const raw = (process.env.APP_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (raw) return raw;
  if ((process.env.NODE_ENV ?? 'development') === 'development') {
    return 'http://127.0.0.1:3002';
  }
  return 'https://desktop-attendance.appnep.com';
}

export const env = {
  port: parseInt(process.env.PORT ?? '3002', 10),
  /**
   * Listen address. Desktop Electron sets HOST=127.0.0.1 so the API is not
   * exposed on the LAN. Cloud/server deploys typically use 0.0.0.0.
   */
  host: (process.env.HOST ?? '0.0.0.0').trim() || '0.0.0.0',
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
  /**
   * Public origin invited users can reach, e.g. https://attendance.appnep.com.
   * In development mode, defaults to http://127.0.0.1:3002 if APP_PUBLIC_URL is not set.
   */
  appPublicUrl: getAppPublicUrl(),
  smtpHost: (process.env.SMTP_HOST ?? '').trim(),
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10) || 587,
  smtpSecure:
    (process.env.SMTP_SECURE ?? '').trim().toLowerCase() === 'true' ||
    ((process.env.SMTP_SECURE ?? '').trim() === '' &&
      (parseInt(process.env.SMTP_PORT || '587', 10) || 587) === 465),
  smtpUser: (process.env.SMTP_USER ?? '').trim(),
  smtpPass: process.env.SMTP_PASS ?? '',
  smtpFrom: (process.env.SMTP_FROM ?? '').trim(),
  insforgeBaseUrl: (process.env.INSFORGE_BASE_URL ?? '').trim(),
  insforgeApiKey: (process.env.INSFORGE_API_KEY ?? '').trim(),
  smsProvider: (process.env.SMS_PROVIDER ?? '').trim().toLowerCase(),
  smsDevMode: (process.env.SMS_DEV_MODE ?? '').trim().toLowerCase() === 'true',
  twilioAccountSid: (process.env.TWILIO_ACCOUNT_SID ?? '').trim(),
  twilioAuthToken: (process.env.TWILIO_AUTH_TOKEN ?? process.env.SMS_API_KEY ?? '').trim(),
  twilioFromNumber: (process.env.TWILIO_FROM_NUMBER ?? process.env.SMS_FROM_NUMBER ?? process.env.SMS_SENDER_ID ?? '').trim(),
  smsApiUrl: (process.env.SMS_API_URL ?? '').trim(),
  smsApiKey: (process.env.SMS_API_KEY ?? '').trim(),
  smsSenderId: (process.env.SMS_SENDER_ID ?? 'PACE').trim(),
};

/**
 * Logs production/local configuration at boot without printing secret values.
 * Missing optional variables warn in production; they do not crash local development.
 */
export function logStartupEnvironment(): void {
  const isProd = env.nodeEnv === 'production';
  const smtpReady = Boolean(env.smtpHost && env.smtpUser && env.smtpPass);
  const insforgeReady = Boolean(env.insforgeBaseUrl && env.insforgeApiKey);
  const databaseSet = Boolean((process.env.DATABASE_URL ?? '').trim());

  console.log('[Server] Configuration:', {
    nodeEnv: env.nodeEnv,
    port: env.port,
    host: env.host,
    appPublicUrl: env.appPublicUrl,
    smtpConfigured: smtpReady,
    smtpHost: env.smtpHost || '(not set)',
    smtpPort: env.smtpPort,
    smtpSecure: env.smtpSecure,
    smtpUserSet: Boolean(env.smtpUser),
    smtpFromSet: Boolean(env.smtpFrom || env.smtpUser),
    insforgeConfigured: insforgeReady,
    databaseUrlSet: databaseSet,
    deviceSyncEnabled: env.deviceSyncEnabled,
  });

  if (!isProd) return;

  if (!smtpReady) {
    console.warn(
      '[Server] SMTP configuration missing. Set SMTP_HOST, SMTP_USER, and SMTP_PASS for invitation emails.',
    );
  }
  if (!insforgeReady) {
    console.warn(
      '[Server] InsForge is not fully configured. Set INSFORGE_BASE_URL and INSFORGE_API_KEY for database/auth/storage.',
    );
  }
  if (!databaseSet) {
    console.warn('[Server] DATABASE_URL is not set. Persistent storage will fall back if PostgreSQL is unreachable.');
  }
  if (/localhost|127\.0\.0\.1/i.test(env.appPublicUrl)) {
    console.warn(
      '[Server] APP_PUBLIC_URL points at loopback. Set it to the public HTTPS origin (e.g. https://desktop-attendance.appnep.com).',
    );
  }
}
