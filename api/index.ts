/**
 * Hosted web API for Vercel / serverless deployments (root /api entrypoint).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runExpressApp, vercelApiConfig } from './runExpressApp.js';

export const config = vercelApiConfig;

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return runExpressApp(req, res);
}
