/**
 * Hosted web API for Vercel / serverless deployments.
 * Express serves all /api/* routes directly on the same origin (e.g. desktop-attendance.appnep.com).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runExpressApp, vercelApiConfig } from './runExpressApp.js';

export const config = vercelApiConfig;

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return runExpressApp(req, res);
}
