/**
 * The attendance machine is on the office LAN. Its login is saved on the
 * shared server so another computer, signed in as admin and on that network,
 * can connect and download punches. The password is not written to logs.
 */
import { env } from '../../config/env.js';
import { saveDevice } from '../../models/DeviceModel.js';
import type { DeviceBrand } from '../../types/index.js';

export function hostedApiBase(): string | null {
  const fromEnv = (process.env.CLOUD_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (fromEnv && !/localhost|127\.0\.0\.1/i.test(fromEnv)) {
    return fromEnv.endsWith('/api') ? fromEnv : `${fromEnv}/api`;
  }
  const origin = env.appPublicUrl.replace(/\/+$/, '');
  if (!origin || /localhost|127\.0\.0\.1/i.test(origin)) return null;
  return `${origin}/api`;
}

export async function publishDeviceProfile(input: {
  name?: string;
  brand?: string;
  model?: string;
  ipAddress: string;
  port: number;
  username: string;
  password: string;
}): Promise<void> {
  const base = hostedApiBase();
  if (!base || !env.deviceSyncEnabled || !input.password || !input.ipAddress) return;
  try {
    const res = await fetch(`${base}/devices/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
      body: JSON.stringify({
        name: input.name || 'Attendance machine',
        brand: input.brand || 'hikvision',
        model: input.model,
        ipAddress: input.ipAddress,
        port: input.port,
        username: input.username,
        password: input.password,
        connectionMode: 'cloud_connector',
      }),
    });
    if (!res.ok) {
      console.info('[Device] Shared machine profile was not updated');
    }
  } catch {
    console.info('[Device] Shared machine profile was not updated');
  }
}

/** Copy the shared machine login onto this computer. Returns true when a profile was saved. */
export async function pullHostedDeviceProfile(): Promise<boolean> {
  const base = hostedApiBase();
  if (!base || !env.deviceSyncEnabled) return false;
  try {
    const res = await fetch(`${base}/devices/lan-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-role': 'admin',
        'x-desktop-lan': '1',
      },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as {
      success?: boolean;
      data?: {
        name?: string;
        brand?: string;
        model?: string;
        ipAddress?: string;
        port?: number;
        username?: string;
        password?: string;
      };
    };
    const data = body.data;
    if (!data?.ipAddress || !data.username || !data.password) return false;
    await saveDevice({
      name: data.name || 'Attendance machine',
      brand: (data.brand as DeviceBrand) || 'hikvision',
      model: data.model,
      ipAddress: data.ipAddress,
      port: Number(data.port) || 80,
      username: data.username,
      password: data.password,
      connectionMode: 'local_direct',
    });
    return true;
  } catch {
    return false;
  }
}
