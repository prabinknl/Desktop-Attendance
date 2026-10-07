/**
 * Hikvision SADP discovery (Search Active Device Protocol).
 *
 * Hikvision devices, including DS-K1T access-control terminals, answer an XML
 * "inquiry" probe sent to UDP multicast 239.255.255.250:37020 with their model,
 * serial number, MAC, IPv4 address and HTTP port. No credentials are involved,
 * so this identifies a machine without logging in to it.
 *
 * Receiving the multicast replies needs an inbound UDP socket; on first use
 * Windows Defender Firewall may ask whether Attendance Desktop may communicate
 * on private networks. If that is declined, SADP simply finds nothing and the
 * caller falls back to the ISAPI subnet scan (outbound TCP only).
 */
import dgram from 'dgram';
import os from 'os';
import { randomUUID } from 'crypto';

const SADP_GROUP = '239.255.255.250';
const SADP_PORT = 37020;

export interface SadpDevice {
  ipAddress: string;
  httpPort?: number;
  commandPort?: number;
  serialNumber?: string;
  model?: string;
  deviceType?: string;
  macAddress?: string;
  firmwareVersion?: string;
  activated?: boolean;
  dhcp?: boolean;
}

export interface SadpResult {
  devices: SadpDevice[];
  /** False when no usable IPv4 interface exists or the UDP socket could not be opened. */
  available: boolean;
  error?: string;
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i'));
  const v = m?.[1]?.trim();
  return v ? v : undefined;
}

function toInt(value?: string): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? n : undefined;
}

function toBool(value?: string): boolean | undefined {
  if (!value) return undefined;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  return undefined;
}

export function normalizeMac(mac?: string | null): string {
  if (!mac) return '';
  const hex = mac.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex.length !== 12) return mac.trim().toLowerCase();
  return hex.match(/.{2}/g)!.join(':');
}

/** Parse a SADP ProbeMatch reply. Returns null for probes and unrelated packets. */
export function parseSadpReply(xml: string, fallbackIp?: string): SadpDevice | null {
  if (!/<ProbeMatch[\s>]/i.test(xml)) return null;
  const ipAddress = tag(xml, 'IPv4Address') ?? fallbackIp;
  if (!ipAddress || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ipAddress)) return null;
  return {
    ipAddress,
    httpPort: toInt(tag(xml, 'HttpPort')),
    commandPort: toInt(tag(xml, 'CommandPort')),
    serialNumber: tag(xml, 'DeviceSN'),
    model: tag(xml, 'DeviceDescription') ?? tag(xml, 'DeviceType'),
    deviceType: tag(xml, 'DeviceType'),
    macAddress: normalizeMac(tag(xml, 'MAC')) || undefined,
    firmwareVersion: tag(xml, 'SoftwareVersion'),
    activated: toBool(tag(xml, 'Activated')),
    dhcp: toBool(tag(xml, 'DHCP')),
  };
}

function localIpv4Addresses(): string[] {
  const out: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (addr.address.startsWith('169.254.')) continue;
      out.push(addr.address);
    }
  }
  return out;
}

function buildProbe(): Buffer {
  const uuid = randomUUID().toUpperCase();
  return Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?><Probe><Uuid>${uuid}</Uuid><Types>inquiry</Types></Probe>`,
    'utf8',
  );
}

function openSocket(port: number): Promise<dgram.Socket> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const onError = (err: Error) => {
      socket.close();
      reject(err);
    };
    socket.once('error', onError);
    socket.bind(port, () => {
      socket.off('error', onError);
      resolve(socket);
    });
  });
}

/**
 * Send SADP inquiries on every local IPv4 interface and collect replies.
 * Bounded by `timeoutMs`; never throws.
 */
export async function discoverSadp(
  opts: { timeoutMs?: number; repeats?: number } = {},
): Promise<SadpResult> {
  const timeoutMs = opts.timeoutMs ?? 3_000;
  const repeats = Math.max(1, opts.repeats ?? 2);
  const interfaces = localIpv4Addresses();
  if (interfaces.length === 0) {
    return { devices: [], available: false, error: 'No local network connection' };
  }

  let socket: dgram.Socket;
  try {
    // Replies are multicast to 37020; fall back to an ephemeral port (unicast replies only).
    socket = await openSocket(SADP_PORT).catch(() => openSocket(0));
  } catch (err) {
    return {
      devices: [],
      available: false,
      error: err instanceof Error ? err.message : 'Could not open UDP socket',
    };
  }

  const found = new Map<string, SadpDevice>();
  socket.on('message', (msg, rinfo) => {
    const device = parseSadpReply(msg.toString('utf8'), rinfo.address);
    if (!device) return;
    const key = device.serialNumber || device.macAddress || device.ipAddress;
    found.set(key, { ...found.get(key), ...device });
  });
  socket.on('error', () => undefined);

  try {
    socket.setMulticastTTL(1);
    socket.setMulticastLoopback(false);
  } catch {
    /* optional */
  }
  for (const address of interfaces) {
    try {
      socket.addMembership(SADP_GROUP, address);
    } catch {
      /* interface may not support multicast */
    }
  }

  const sendAll = () => {
    for (const address of interfaces) {
      try {
        socket.setMulticastInterface(address);
        socket.send(buildProbe(), SADP_PORT, SADP_GROUP);
      } catch {
        /* try next interface */
      }
    }
  };

  const gap = Math.floor(timeoutMs / (repeats + 1));
  for (let i = 0; i < repeats; i++) {
    sendAll();
    await new Promise((r) => setTimeout(r, gap));
  }
  await new Promise((r) => setTimeout(r, Math.max(0, timeoutMs - gap * repeats)));

  try {
    socket.close();
  } catch {
    /* already closed */
  }
  return { devices: [...found.values()], available: true };
}
