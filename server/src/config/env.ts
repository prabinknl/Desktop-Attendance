import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/src/config → server/.env (primary), then repo-root .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const env = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/attendance_db',
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  /**
   * Mock mode is disabled. Real Hikvision ISAPI is always used.
   * DEVICE_MOCK_MODE is ignored if set — kept only so old .env files do not break boot.
   */
  deviceMockMode: false,
  adminSignupEmail: (process.env.ADMIN_SIGNUP_EMAIL ?? 'appnep@pacenp.com').trim().toLowerCase(),
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: parseInt(process.env.SMTP_PORT ?? '587', 10),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  smtpFrom: process.env.SMTP_FROM ?? '',
};
