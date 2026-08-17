import type { IDeviceAdapter } from './IDeviceAdapter.js';
import { createDeviceAdapter } from './DeviceFactory.js';
import { decryptPassword } from '../crypto/passwordCrypto.js';
import type { DeviceRecord } from '../../types/index.js';

/**
 * Keep one live adapter per device identity so AcsEvent strategy / serial
 * survive across syncs. Recreating the adapter on every sync forces a slow
 * multi-variant probe on each "Get records".
 */
let cached: { key: string; adapter: IDeviceAdapter } | null = null;

function sessionKey(device: DeviceRecord): string {
  return [
    device.id,
    device.brand,
    device.ip_address,
    String(device.port),
    device.username ?? 'admin',
    device.password_encrypted ?? '',
    device.model ?? '',
  ].join('|');
}

export function getOrCreateDeviceAdapter(device: DeviceRecord): IDeviceAdapter {
  const key = sessionKey(device);
  if (cached?.key === key) return cached.adapter;

  const password = device.password_encrypted ? decryptPassword(device.password_encrypted) : '';
  const adapter = createDeviceAdapter(device.brand, {
    ipAddress: device.ip_address,
    port: device.port,
    username: device.username ?? 'admin',
    password,
    model: device.model ?? undefined,
  });
  cached = { key, adapter };
  return adapter;
}

export function clearDeviceAdapterCache(): void {
  const prev = cached?.adapter;
  cached = null;
  if (prev) {
    void prev.disconnect().catch(() => undefined);
  }
}
