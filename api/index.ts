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
  const reqUrl = req.url ?? '/';
  const matchedPath =
    (req.headers['x-matched-path'] as string) ||
    (req.headers['x-forwarded-url'] as string) ||
    '';

  let resolved = reqUrl;
  if ((reqUrl === '/api' || reqUrl === '/api/' || reqUrl === '/') && matchedPath && matchedPath.startsWith('/api')) {
    resolved = matchedPath;
  }

  if (!resolved.startsWith('/api')) {
    resolved = `/api${resolved.startsWith('/') ? resolved : `/${resolved}`}`;
  }

  req.url = resolved;
  return app(req, res);
}
