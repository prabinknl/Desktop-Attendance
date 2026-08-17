import crypto from 'crypto';
import { env } from '../../config/env.js';
import type { DeviceRecord } from '../../types/index.js';

const TOKEN_BYTES = 32;

export function generateConnectorToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashConnectorToken(token) };
}

export function hashConnectorToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Validate connector Bearer token against device hash and optional legacy GATEWAY_SECRET. */
export function verifyConnectorToken(device: DeviceRecord | null, bearer: string): boolean {
  const token = bearer.trim();
  if (!token) return false;

  if (device?.connector_token_hash) {
    const hash = hashConnectorToken(token);
    return timingSafeEqual(hash, device.connector_token_hash);
  }

  const legacy = env.gatewaySecret;
  if (legacy && timingSafeEqual(token, legacy)) {
    return true;
  }

  return false;
}
