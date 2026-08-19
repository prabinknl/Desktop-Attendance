/**
 * Hosted web API for Vercel / serverless deployments (root /api entrypoint).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import app from '../server/src/app.js';

process.env.DEVICE_SYNC_ENABLED ??= 'false';
process.env.APP_PUBLIC_URL ??= 'https://desktop-attendance.appnep.com';

export const config = {
  api: { bodyParser: false },
  maxDuration: 30,
};

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const original = req.url ?? '/';
  if (!original.startsWith('/api')) {
    const path = original.startsWith('/') ? original : `/${original}`;
    req.url = `/api${path}`;
  }
  return app(req, res);
}
