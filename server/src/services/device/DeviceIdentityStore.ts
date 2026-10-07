/**
 * Identity of the attendance machine this computer is paired with.
 *
 * Kept per computer (ATTENDANCE_DATA_DIR/device-identity.json) rather than in
 * the shared database: pairing is a property of the local network, and the
 * file needs no schema change. Holds no credentials.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeMac } from './SadpDiscovery.js';

export interface PairedIdentity {
  deviceId: string;
  serialNumber?: string;
  macAddress?: string;
  model?: string;
  firmwareVersion?: string;
  lastIpAddress?: string;
  lastPort?: number;
  pairedAt: string;
  verifiedAt?: string;
  /** Set by "Disconnect"; automatic connection stays off until Connect / Retry. */
  autoConnectPaused?: boolean;
}

let moduleDir = process.cwd();
try {
  moduleDir = path.dirname(fileURLToPath(import.meta.url));
} catch {
  /* fall back to cwd */
}

const DATA_DIR = path.resolve(
  process.env.ATTENDANCE_DATA_DIR?.trim() || path.join(moduleDir, '../../../data'),
);
const IDENTITY_FILE = path.join(DATA_DIR, 'device-identity.json');

let cache: PairedIdentity | null | undefined;

function load(): PairedIdentity | null {
  if (cache !== undefined) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8')) as PairedIdentity;
    cache = parsed && typeof parsed.deviceId === 'string' ? parsed : null;
  } catch {
    cache = null;
  }
  return cache;
}

function persist(identity: PairedIdentity | null): void {
  cache = identity;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!identity) {
      fs.rmSync(IDENTITY_FILE, { force: true });
      return;
    }
    const tmp = `${IDENTITY_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(identity, null, 2), 'utf8');
    fs.renameSync(tmp, IDENTITY_FILE);
  } catch (err) {
    console.warn('[Device] Could not save paired identity:', err instanceof Error ? err.message : err);
  }
}

export function getPairedIdentity(deviceId: string): PairedIdentity | null {
  const identity = load();
  return identity && identity.deviceId === deviceId ? identity : null;
}

export function savePairedIdentity(
  deviceId: string,
  observed: {
    serialNumber?: string;
    macAddress?: string;
    model?: string;
    firmwareVersion?: string;
    ipAddress?: string;
    port?: number;
  },
): PairedIdentity {
  const previous = getPairedIdentity(deviceId);
  const sameMachine = previous ? identityMatches(previous, observed) !== 'mismatch' : false;
  const next: PairedIdentity = {
    deviceId,
    serialNumber: observed.serialNumber || (sameMachine ? previous?.serialNumber : undefined),
    macAddress: normalizeMac(observed.macAddress) || (sameMachine ? previous?.macAddress : undefined),
    model: observed.model || (sameMachine ? previous?.model : undefined),
    firmwareVersion: observed.firmwareVersion || (sameMachine ? previous?.firmwareVersion : undefined),
    lastIpAddress: observed.ipAddress ?? previous?.lastIpAddress,
    lastPort: observed.port ?? previous?.lastPort,
    pairedAt: sameMachine && previous ? previous.pairedAt : new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    autoConnectPaused: false,
  };
  persist(next);
  return next;
}

export function setAutoConnectPaused(deviceId: string, paused: boolean): void {
  const identity = getPairedIdentity(deviceId);
  if (identity) {
    persist({ ...identity, autoConnectPaused: paused });
  } else if (paused) {
    persist({ deviceId, pairedAt: new Date().toISOString(), autoConnectPaused: true });
  }
}

function normalizeSerial(serial?: string | null): string {
  return String(serial ?? '').replace(/\s+/g, '').toUpperCase();
}

/** SADP and ISAPI may report the full serial or only its trailing short form. */
export function serialsMatch(a?: string | null, b?: string | null): boolean {
  const x = normalizeSerial(a);
  const y = normalizeSerial(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [longer, shorter] = x.length >= y.length ? [x, y] : [y, x];
  return shorter.length >= 9 && longer.endsWith(shorter);
}

/**
 * Compare a paired identity with what a device reports.
 * 'unknown' when neither a serial nor a MAC can be compared.
 */
export function identityMatches(
  identity: Pick<PairedIdentity, 'serialNumber' | 'macAddress'>,
  observed: { serialNumber?: string; macAddress?: string },
): 'match' | 'mismatch' | 'unknown' {
  if (identity.serialNumber && observed.serialNumber) {
    return serialsMatch(identity.serialNumber, observed.serialNumber) ? 'match' : 'mismatch';
  }
  const a = normalizeMac(identity.macAddress);
  const b = normalizeMac(observed.macAddress);
  if (a && b) return a === b ? 'match' : 'mismatch';
  return 'unknown';
}
