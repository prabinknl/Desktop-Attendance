import net from 'net';
import os from 'os';
import http from 'http';
import https from 'https';
import type { DiscoveredDevice, ScanResult } from '../../types/index.js';
import { logDeviceAction } from './deviceLogger.js';

const HIKVISION_PORTS = [80, 8000, 443];

/** Check if a TCP port is open on a host (fast timeout). */
function probePort(host: string, port: number, timeoutMs = 500): Promise<boolean> {
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
 * Identify Hikvision ISAPI by requesting /ISAPI/System/deviceInfo.
 * Extracts model from XML or Digest realm challenge (e.g. realm="DS-K1T320EFWX").
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
          const authHeader = Array.isArray(www) ? www[0] : (www || '');
          const serverHeader = String(res.headers['server'] || '');
          const hasDigestChallenge = !!authHeader && /digest/i.test(authHeader);
          const isHikServer = /hikvision|webs|app-webs|dvr|nvr/i.test(serverHeader);
          const hasIsapiBody =
            /<DeviceInfo[\s>]|<model[\s>]|<ResponseStatus[\s>]|ISAPI|Hikvision/i.test(data);

          // Require Digest challenge, Hikvision server header, or genuine ISAPI/Hikvision body
          if (!hasDigestChallenge && !hasIsapiBody && !isHikServer) {
            resolve(null);
            return;
          }

          const modelMatch = data.match(/<model[^>]*>([^<]+)<\/model>/i);
          const macMatch = data.match(/<macAddress[^>]*>([^<]+)<\/macAddress>/i);
          const realmMatch = authHeader.match(/realm="([^"]+)"/i);

          let detectedModel = modelMatch?.[1]?.trim();
          if (!detectedModel && realmMatch?.[1] && !/ip\s*camera/i.test(realmMatch[1])) {
            detectedModel = realmMatch[1].trim();
          }

          resolve({
            model: detectedModel || 'Hikvision (ISAPI)',
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

/**
 * Filter out virtual/APIPA adapters (169.254.*, 127.*) and return valid LAN subnets.
 */
export function getLocalNetworkInfo(prioritizeSubnet?: string): {
  addresses: Array<{ address: string; subnet: string }>;
  subnets: string[];
} {
  const addresses: Array<{ address: string; subnet: string }> = [];
  const subnetsSet = new Set<string>();
  const interfaces = os.networkInterfaces();

  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        // Skip APIPA link-local (169.254.x.x) and loopback
        if (addr.address.startsWith('169.254.') || addr.address.startsWith('127.')) {
          continue;
        }
        const parts = addr.address.split('.');
        const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
        addresses.push({ address: addr.address, subnet });
        subnetsSet.add(subnet);
      }
    }
  }

  let subnets = [...subnetsSet];
  if (prioritizeSubnet && subnets.includes(prioritizeSubnet)) {
    subnets = [prioritizeSubnet, ...subnets.filter((s) => s !== prioritizeSubnet)];
  }

  return { addresses, subnets };
}

function getLocalSubnets(): string[] {
  return getLocalNetworkInfo().subnets;
}

/**
 * Helper to run an array of async tasks with concurrency limit.
 */
async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit = 48): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Scan the local network for Hikvision ISAPI devices only.
 * Fast, concurrency-controlled scan of valid local subnets.
 */
export async function scanNetwork(preferredSubnet?: string, customPort?: number): Promise<ScanResult> {
  const netInfo = getLocalNetworkInfo(preferredSubnet);
  const subnets = netInfo.subnets;

  if (subnets.length === 0) {
    console.info('[Device] No local IP/subnet detected — computer may be offline');
    logDeviceAction({
      action: 'scanNetwork',
      result: 'error',
      message: 'No local subnet for discovery',
    });
    return {
      devices: [],
      discoveryAvailable: false,
      message:
        'Computer is not connected to a local network. Connect to Wi-Fi or LAN, then use Scan Again.',
    };
  }

  const portsToScan = [...HIKVISION_PORTS];
  if (customPort && !portsToScan.includes(customPort) && customPort > 0 && customPort <= 65535) {
    portsToScan.push(customPort);
  }

  console.log(
    `[Device] Local IP and subnet detected: ${netInfo.addresses
      .map((a) => `${a.address} (subnet ${a.subnet}.0/24)`)
      .join(', ')}`,
  );
  console.log(`[Device] Subnet scan started on ${subnets.join(', ')} ports ${portsToScan.join(',')}`);

  const results: DiscoveredDevice[] = [];
  const seen = new Set<string>();
  const probeTasks: Array<() => Promise<void>> = [];

  for (const subnet of subnets) {
    for (let host = 1; host <= 254; host++) {
      const ip = `${subnet}.${host}`;
      for (const port of portsToScan) {
        probeTasks.push(async () => {
          const open = await probePort(ip, port);
          if (!open) return;
          const key = `${ip}:${port}`;
          if (seen.has(key)) return;

          const hik = await probeHikvisionIsapi(ip, port);
          if (!hik) return;

          seen.add(key);
          console.log(
            `[Device] Compatible device found: ${ip}:${port} model=${hik.model}`,
          );
          results.push({
            brand: 'hikvision',
            model: hik.model,
            ipAddress: ip,
            macAddress: hik.macAddress,
            port,
            status: 'reachable',
          });
        });
      }
    }
  }

  await runWithConcurrency(probeTasks, 48);

  logDeviceAction({
    action: 'scanNetwork',
    result: 'ok',
    message: `found=${results.length}`,
  });

  if (results.length === 0) {
    console.info('[Device] Device not found on the local network');
    return {
      devices: [],
      discoveryAvailable: true,
      message: 'Device not found on the local network',
    };
  }

  return { devices: results, discoveryAvailable: true };
}

export { getDefaultPort } from './DeviceFactory.js';
