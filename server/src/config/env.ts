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
    return 'http://127.0.0.1:3000';
  }
  return 'https://desktop-attendance.appnep.com';
}

function hasMysqlDiscreteConfig(): boolean {
  return Boolean(
    (process.env.DB_HOST ?? '').trim() &&
      (process.env.DB_NAME ?? '').trim() &&
      (process.env.DB_USER ?? '').trim(),
  );
}

function resolveDatabaseUrl(): string {
  const fromEnv = (process.env.DATABASE_URL ?? '').trim();
  if (fromEnv) return fromEnv;
  // When MySQL discrete config is present, do not force a Postgres default.
  if (hasMysqlDiscreteConfig()) return '';
  if (/^mysql(\+[^:]*)?:\/\//i.test(fromEnv) || /^mariadb:\/\//i.test(fromEnv)) return fromEnv;
  return 'postgresql://postgres:password@localhost:5432/attendance_db';
}

export const env = {
  /**
   * Hostinger injects PORT. Local/Electron keep 3002 so Vite can use 3000.
   * Production fallback is 3000 only when PORT is unset.
   */
  port: parseInt(
    process.env.PORT ||
      ((process.env.NODE_ENV ?? 'development') === 'production' ? '3000' : '3002'),
    10,
  ),
  /**
   * Listen address. Desktop Electron sets HOST=127.0.0.1 so the API is not
   * exposed on the LAN. Cloud/server deploys typically use 0.0.0.0.
   */
  host: (process.env.HOST ?? '0.0.0.0').trim() || '0.0.0.0',
  corsOrigins: parseCorsOrigins(),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: resolveDatabaseUrl(),
  dbHost: (process.env.DB_HOST ?? '').trim(),
  dbPort: parseInt(process.env.DB_PORT || '3306', 10) || 3306,
  dbName: (process.env.DB_NAME ?? '').trim(),
  dbUser: (process.env.DB_USER ?? '').trim(),
  dbPassword: process.env.DB_PASSWORD ?? '',
  /** Optional JWT secret for future auth hardening — not required today. */
  jwtSecret: (process.env.JWT_SECRET ?? '').trim(),
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
  deviceSyncEnabled:
    (process.env.DEVICE_SYNC_ENABLED ??
      ((process.env.NODE_ENV ?? 'development') === 'production' &&
      (process.env.ELECTRON_DESKTOP ?? '').trim() !== '1'
        ? 'false'
        : 'true')).toLowerCase() !== 'false',
  /** Legacy shared secret; prefer per-device connector_token_hash when set. */
  gatewaySecret: (process.env.GATEWAY_SECRET ?? '').trim(),
  /** Expected connector heartbeat interval (seconds). */
  connectorHeartbeatSeconds: Math.max(15, parseInt(process.env.CONNECTOR_HEARTBEAT_SECONDS ?? '30', 10)),
  adminSignupEmail: (process.env.ADMIN_SIGNUP_EMAIL ?? 'appnep@pacenp.com').trim().toLowerCase(),
  /**
   * Public origin invited users can reach, e.g. https://attendance.appnep.com.
   * In development mode, defaults to http://127.0.0.1:3000 if APP_PUBLIC_URL is not set.
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
  /** Legacy / optional InsForge BaaS (migration fallback). */
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
  const mysqlConfigured =
    hasMysqlDiscreteConfig() ||
    /^(mysql(\+[^:]*)?|mariadb):\/\//i.test(env.databaseUrl || '');

  const driverOverride = (process.env.DB_DRIVER ?? '').trim().toLowerCase();
  let dbDriverLabel: 'mysql' | 'postgres' = 'postgres';
  if (driverOverride === 'mysql' || driverOverride === 'mariadb') dbDriverLabel = 'mysql';
  else if (driverOverride === 'postgres' || driverOverride === 'postgresql' || driverOverride === 'pg') {
    dbDriverLabel = 'postgres';
  } else if (mysqlConfigured) {
    dbDriverLabel = 'mysql';
  } else if (/^postgres(ql)?:\/\//i.test(env.databaseUrl || process.env.DATABASE_URL || '')) {
    dbDriverLabel = 'postgres';
  }

  console.log('[Server] Configuration:', {
    nodeEnv: env.nodeEnv,
    port: env.port,
    host: env.host,
    appPublicUrl: env.appPublicUrl,
    dbDriver: dbDriverLabel,
    mysqlConfigured,
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
  if (dbDriverLabel === 'postgres' && !insforgeReady) {
    console.warn(
      '[Server] InsForge is optional/legacy during MySQL migration. Set INSFORGE_BASE_URL and INSFORGE_API_KEY only if you still need the Postgres/InsForge fallback.',
    );
  }
  if (!mysqlConfigured && !databaseSet) {
    console.warn(
      '[Server] No database configured. Set DB_HOST/DB_NAME/DB_USER (MySQL) or DATABASE_URL (legacy Postgres).',
    );
  }
  if (/localhost|127\.0\.0\.1/i.test(env.appPublicUrl)) {
    console.warn(
      '[Server] APP_PUBLIC_URL points at loopback. Set it to the public HTTPS origin (e.g. https://desktop-attendance.appnep.com).',
    );
  }
}

/** True for the bundled local API inside the desktop app, which never sends mail. */
export function isDesktopLocalApi(): boolean {
  return (
    (process.env.ELECTRON_DESKTOP ?? '').trim() === '1' ||
    (process.env.LOCAL_DESKTOP_API ?? '').trim() === '1'
  );
}

/**
 * Variables the hosted deployment must supply. Mail delivery and the shared
 * database both live on the server; the desktop app has neither and is exempt.
 */
const REQUIRED_HOSTED_ENV = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'APP_PUBLIC_URL',
] as const;

export interface EnvValidationResult {
  ok: boolean;
  missing: string[];
  skipped: boolean;
}

/**
 * Checks required configuration at boot. Only variable *names* are ever
 * printed — values are never logged, so a startup transcript is safe to share.
 *
 * Set STRICT_ENV_VALIDATION=true to make a misconfigured deploy fail fast
 * instead of starting and failing later on the first email.
 */
export function validateStartupEnvironment(): EnvValidationResult {
  if (env.nodeEnv !== 'production' || isDesktopLocalApi()) {
    return { ok: true, missing: [], skipped: true };
  }

  const missing: string[] = REQUIRED_HOSTED_ENV.filter(
    (key) => !(process.env[key] ?? '').toString().trim(),
  );

  // SMTP_SECURE is optional: it is inferred from SMTP_PORT when unset.
  if (!(process.env.SMTP_SECURE ?? '').trim()) {
    console.log(
      `[Server] SMTP_SECURE not set — inferring ${env.smtpSecure} from SMTP_PORT ${env.smtpPort}.`,
    );
  }

  const databaseConfigured =
    hasMysqlDiscreteConfig() || Boolean((process.env.DATABASE_URL ?? '').trim());
  if (!databaseConfigured) {
    missing.push('DB_HOST/DB_NAME/DB_USER (or DATABASE_URL)');
  }

  if (missing.length === 0) {
    console.log('[Server] Environment validation passed for all required variables.');
    return { ok: true, missing: [], skipped: false };
  }

  console.error(
    `[Server] Environment validation FAILED. Missing required variables: ${missing.join(', ')}. ` +
      'Set them in the hosting environment (Hostinger → Node.js app → Environment variables), ' +
      'never as VITE_* variables. Values are intentionally not logged.',
  );

  if ((process.env.STRICT_ENV_VALIDATION ?? '').trim().toLowerCase() === 'true') {
    console.error('[Server] STRICT_ENV_VALIDATION=true — refusing to start.');
    process.exit(1);
  }

  return { ok: false, missing, skipped: false };
}
