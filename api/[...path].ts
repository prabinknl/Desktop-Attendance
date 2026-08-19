/**
 * Hosted web API. Vercel only serves the Vite SPA unless /api is a function.
 * Owner "Send Verification Code" posts to /api/auth/admin/send-code on the
 * same origin (desktop-attendance.appnep.com).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import serverless from 'serverless-http';

process.env.DEVICE_SYNC_ENABLED ??= 'false';
process.env.APP_PUBLIC_URL ??= 'https://desktop-attendance.appnep.com';

export const config = {
  api: { bodyParser: false },
  maxDuration: 30,
};

let handle: ((req: IncomingMessage, res: ServerResponse) => Promise<unknown>) | null = null;

async function getHandle() {
  if (!handle) {
    const { default: app } = await import('../server/src/app.js');
    handle = serverless(app) as (req: IncomingMessage, res: ServerResponse) => Promise<unknown>;
  }
  return handle;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const original = req.url ?? '/';
  if (!original.startsWith('/api')) {
    const path = original.startsWith('/') ? original : `/${original}`;
    req.url = `/api${path}`;
  }
  const run = await getHandle();
  return run(req, res);
}
