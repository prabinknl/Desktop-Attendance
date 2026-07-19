import net from 'net';
import os from 'os';
import http from 'http';
import https from 'https';
import type { DiscoveredDevice, ScanResult } from '../../types/index.js';
import { logDeviceAction } from './deviceLogger.js';

const HIKVISION_PORTS = [80, 8000, 443];

/** Check if a TCP port is open on a host (fast timeout). */
function probePort(host: string, port: number, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/**
 * Identify Hikvision ISAPI by requesting /ISAPI/System/deviceInfo without inventing MACs/models.
 * Returns null if the host is not a Hikvision ISAPI device (or credentials required).
 */
async function probeHikvisionIsapi(
  ip: string,
  port: number,
): Promise<{ model: string; macAddress: string } | null> {
  return new Promise((resolve) => {
    const useHttps = port === 443;
    const transport = useHttps ? https : http;
    const req = transport.request(
      {
        hostname: ip,
        port,
        path: '/ISAPI/System/deviceInfo',
        method: 'GET',
        timeout: 1500,
        ...(useHttps ? { rejectUnauthorized: false } : {}),
      } as http.RequestOptions,
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          const www = res.headers['www-authenticate'];
          const authHeader = Array.isArray(www) ? www[0] : www;
          const hasDigestChallenge = !!authHeader && /digest/i.test(authHeader);
          const hasIsapiBody =
            /<DeviceInfo[\s>]|<model[\s>]|ISAPI|Hikvision/i.test(data);

          // Require Digest challenge or genuine ISAPI/Hikvision body — never invent identity
          if (!hasDigestChallenge && !hasIsapiBody) {
            resolve(null);
            return;
          }

          const modelMatch = data.match(/<model[^>]*>([^<]+)<\/model>/i);
          const macMatch = data.match(/<macAddress[^>]*>([^<]+)<\/macAddress>/i);
          resolve({
            model: modelMatch?.[1]?.trim() || 'Hikvision (ISAPI)',
            macAddress: macMatch?.[1]?.trim() || '',
          });
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

function getLocalSubnets(): string[] {
  const subnets = new Set<string>();
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const parts = addr.address.split('.');
        subnets.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
      }
    }
  }
  return [...subnets];
}

/**
 * Scan the local network for Hikvision ISAPI devices only.
 * Does not return hardcoded / mock devices. Does not invent MAC addresses.
 * If no local subnet is available, discovery is reported as unavailable.
 */
export async function scanNetwork(): Promise<ScanResult> {
  const subnets = getLocalSubnets();

  if (subnets.length === 0) {
    logDeviceAction({
      action: 'scanNetwork',
      result: 'error',
      message: 'No local subnet for discovery',
    });
    return {
      devices: [],
      discoveryAvailable: false,
      message:
        'Automatic Hikvision discovery is not available. Enter the device IP manually.',
    };
  }

  const results: DiscoveredDevice[] = [];
  const seen = new Set<string>();

  for (const subnet of subnets) {
    const probes: Promise<void>[] = [];
    for (let host = 1; host <= 254; host++) {
      const ip = `${subnet}.${host}`;
      for (const port of HIKVISION_PORTS) {
        probes.push(
          (async () => {
            const open = await probePort(ip, port);
            if (!open) return;
            const key = `${ip}:${port}`;
            if (seen.has(key)) return;

            const hik = await probeHikvisionIsapi(ip, port);
            if (!hik) return;

            seen.add(key);
            results.push({
              brand: 'hikvision',
              model: hik.model,
              ipAddress: ip,
              macAddress: hik.macAddress,
              port,
              status: 'reachable',
            });
          })(),
        );
      }
    }
    await Promise.all(probes);
  }

  logDeviceAction({
    action: 'scanNetwork',
    result: 'ok',
    message: `found=${results.length}`,
  });

  if (results.length === 0) {
    return {
      devices: [],
      discoveryAvailable: true,
      message:
        'No Hikvision ISAPI devices found on the local network. Enter the device IP manually.',
    };
  }

  return { devices: results, discoveryAvailable: true };
}

export { getDefaultPort } from './DeviceFactory.js';
