/**
 * Hostinger Node.js Web App entry (Business / Cloud hPanel).
 *
 * hPanel settings:
 *   Application type: Express
 *   Node.js version: 22
 *   Build command: npm run build:web
 *   Entry file: server.js
 *
 * Hostinger injects PORT; do not hardcode the listen port in this file.
 */
process.env.NODE_ENV ??= 'production';
process.env.APP_PUBLIC_URL ??= 'https://desktop-attendance.appnep.com';
process.env.DEVICE_SYNC_ENABLED ??= 'false';

import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = path.resolve(process.cwd(), 'server/dist/index.js');
if (!existsSync(entry)) {
  console.error(
    '[Server] server/dist/index.js not found. Set the Hostinger build command to: npm run build:web',
  );
  process.exit(1);
}

await import(pathToFileURL(entry).href);
