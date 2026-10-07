/**
 * Automatic connection to the saved attendance machine (desktop / LAN only).
 *
 * One guarded cycle at a time:
 *   1. Log in at the saved IP/port with the stored credentials.
 *   2. If that fails (not an auth failure), discover machines on the LAN
 *      (SADP, then a rate-limited ISAPI subnet scan) and accept a candidate
 *      only when it authenticates AND matches the paired serial number/MAC.
 *   3. Save the new address on the existing device row (no duplicates).
 *
 * Failures back off 5 s → 5 min. Authentication failures stop automatic retries
 * until the credentials change, so the terminal's login lockout is not tripped.
 * While online a light TCP health check (30 s) and a full identity check
 * (5 min) detect machine restarts, network changes and sleep/resume.
 * Passwords are never logged or returned.
 */
import net from 'net';
import os from 'os';
import crypto from 'crypto';
import {
  getActiveDeviceRecord,
  updateDeviceStatus,
  updateDeviceMeta,
  updateDeviceAddress,
  updateConnectionMode,
  getAdapterForDevice,
} from '../../models/DeviceModel.js';
import { refreshSyncScheduler } from './BackgroundSyncService.js';
import { syncDeviceAttendance } from './SyncService.js';
import { getLocalNetworkInfo } from './NetworkScanner.js';
import { discoverDevices, isCompatibleModel } from './DeviceDiscovery.js';
import { createDeviceAdapter } from './DeviceFactory.js';
import { decryptPassword } from '../crypto/passwordCrypto.js';
import {
  getPairedIdentity,
  savePairedIdentity,
  identityMatches,
  setAutoConnectPaused,
  type PairedIdentity,
} from './DeviceIdentityStore.js';
import { withDeviceLock } from './deviceLock.js';
import { env } from '../../config/env.js';
import { publishDeviceProfile, pullHostedDeviceProfile } from '../cloud/hostedDeviceProfile.js';
import type {
  ConnectionTestResult,
  DeviceInfo,
  DeviceRecord,
  DeviceStatus,
  DiscoveredDevice,
} from '../../types/index.js';

const BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000];
const HEALTH_INTERVAL_MS = 30_000;
const VERIFY_INTERVAL_MS = 5 * 60_000;
const NETWORK_POLL_MS = 10_000;
const SUBNET_SCAN_MIN_GAP_MS = 10 * 60_000;
const UNCONFIGURED_REDISCOVERY_MS = 10 * 60_000;
const MAX_CANDIDATES_PER_CYCLE = 5;
const REQUEST_MIN_GAP_MS = 15_000;

export type ConnectionPhase =
  | 'disabled'
  | 'not_configured'
  | 'needs_credentials'
  | 'paused'
  | 'connecting'
  | 'discovering'
  | 'online'
  | 'offline'
  | 'auth_failed'
  | 'needs_selection';

export interface DeviceConnectionState {
  phase: ConnectionPhase;
  message: string;
  detail: string | null;
  attempt: number;
  nextRetryAt: string | null;
  lastAttemptAt: string | null;
  lastOnlineAt: string | null;
  lastChangeAt: string;
  deviceId: string | null;
  deviceName: string | null;
  ipAddress: string | null;
  port: number | null;
  model: string | null;
  serialNumber: string | null;
  macAddress: string | null;
  firmwareVersion: string | null;
  paired: boolean;
  candidates: DiscoveredDevice[];
  discoveryAt: string | null;
  sadpAvailable: boolean | null;
}

export type ReconnectOutcome =
  | { connected: true; ipAddress: string; port: number; model?: string }
  | {
      connected: false;
      reason:
        | 'no_device'
        | 'no_credentials'
        | 'connector_mode'
        | 'sync_disabled'
        | 'no_local_network'
        | 'authentication_failed'
        | 'device_unavailable'
        | 'not_hikvision'
        | 'needs_selection'
        | 'paused'
        | 'busy';
      message: string;
    };

interface CycleOptions {
  /** User asked explicitly: ignores the auth-failure hold and the scan rate limit. */
  force?: boolean;
  allowSubnetScan?: boolean;
}

let state: DeviceConnectionState = {
  phase: env.deviceSyncEnabled ? 'connecting' : 'disabled',
  message: env.deviceSyncEnabled ? 'Starting…' : 'Device sync is disabled on this server',
  detail: null,
  attempt: 0,
  nextRetryAt: null,
  lastAttemptAt: null,
  lastOnlineAt: null,
  lastChangeAt: new Date().toISOString(),
  deviceId: null,
  deviceName: null,
  ipAddress: null,
  port: null,
  model: null,
  serialNumber: null,
  macAddress: null,
  firmwareVersion: null,
  paired: false,
  candidates: [],
  discoveryAt: null,
  sadpAvailable: null,
};

let inFlight: Promise<ReconnectOutcome> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let networkTimer: ReturnType<typeof setInterval> | null = null;
let failures = 0;
let healthFailures = 0;
let lastVerifyAt = 0;
let lastSubnetScanAt = 0;
let authFailedFingerprint: string | null = null;
let suspended = false;
let watchersStarted = false;

function setState(patch: Partial<DeviceConnectionState>): void {
  const phaseChanged = patch.phase !== undefined && patch.phase !== state.phase;
  state = { ...state, ...patch };
  if (phaseChanged) {
    state.lastChangeAt = new Date().toISOString();
    console.log(`[Device] Connection: ${state.phase} — ${state.message}`);
  }
}

function applyRecord(record: DeviceRecord, identity: PairedIdentity | null): void {
  setState({
    deviceId: record.id,
    deviceName: record.name,
    ipAddress: record.ip_address,
    port: record.port,
    model: record.model ?? identity?.model ?? null,
    serialNumber: identity?.serialNumber ?? null,
    macAddress: record.mac_address ?? identity?.macAddress ?? null,
    firmwareVersion: identity?.firmwareVersion ?? null,
    paired: Boolean(identity?.serialNumber || identity?.macAddress),
  });
}

function credentialFingerprint(record: DeviceRecord): string {
  return crypto
    .createHash('sha256')
    .update(`${record.id}|${record.username ?? ''}|${record.password_encrypted ?? ''}`)
    .digest('hex');
}

async function setDbStatus(record: DeviceRecord, status: DeviceStatus): Promise<void> {
  if (record.status === status) return;
  await updateDeviceStatus(record.id, status).catch(() => undefined);
  record.status = status;
  if (status === 'offline') await refreshSyncScheduler().catch(() => undefined);
}

function tcpProbe(host: string, port: number, timeoutMs = 2_500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

type Verification =
  | { kind: 'ok'; result: ConnectionTestResult }
  | { kind: 'auth_failed'; message: string }
  | { kind: 'mismatch'; message: string }
  | { kind: 'unreachable'; message: string }
  | { kind: 'not_device'; message: string };

async function verifyAt(
  record: DeviceRecord,
  password: string,
  ipAddress: string,
  port: number,
  identity: PairedIdentity | null,
): Promise<Verification> {
  const isSaved = ipAddress === record.ip_address && port === record.port;
  // Reuse the live adapter for the saved address so digest/AcsEvent strategies stay warm.
  const adapter = isSaved
    ? getAdapterForDevice(record)
    : createDeviceAdapter(record.brand, {
        ipAddress,
        port,
        username: record.username?.trim() || 'admin',
        password,
        model: record.model ?? undefined,
      });

  let result: ConnectionTestResult;
  try {
    result = await adapter.testConnection();
  } catch (err) {
    return { kind: 'unreachable', message: err instanceof Error ? err.message : 'Connection failed' };
  }

  if (result.online) {
    if (identity) {
      const cmp = identityMatches(identity, {
        serialNumber: result.deviceInfo?.serialNumber,
        macAddress: result.deviceInfo?.macAddress,
      });
      if (cmp === 'mismatch') {
        return {
          kind: 'mismatch',
          message: `A different machine (${result.deviceInfo?.model ?? 'unknown model'}) answered at ${ipAddress}:${port}`,
        };
      }
    }
    return { kind: 'ok', result };
  }
  if (result.authState === 'authentication_failed') return { kind: 'auth_failed', message: result.message };
  if (result.authState === 'reachable' || result.authState === 'isapi_unsupported') {
    return { kind: 'not_device', message: result.message };
  }
  return { kind: 'unreachable', message: result.message };
}

/** Candidates worth a login attempt, best first; never the already-tried saved endpoint. */
function rankCandidates(
  devices: DiscoveredDevice[],
  record: DeviceRecord,
  identity: PairedIdentity | null,
): DiscoveredDevice[] {
  const genericModel = (m: string) => /^Hikvision( device| \(ISAPI\))?$/i.test(m.trim());
  const scored: Array<{ d: DiscoveredDevice; score: number }> = [];
  for (const d of devices) {
    if (d.ipAddress === record.ip_address && d.port === record.port) continue;
    if (d.activated === false) continue;
    const cmp = identity ? identityMatches(identity, d) : 'unknown';
    if (cmp === 'mismatch') continue;
    if (cmp === 'match') {
      scored.push({ d, score: 3 });
      continue;
    }
    if (isCompatibleModel(d.model)) scored.push({ d, score: 2 });
    else if (genericModel(d.model)) scored.push({ d, score: 1 });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES_PER_CYCLE)
    .map((s) => s.d);
}

function parseDeviceTime(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

async function markConnected(
  record: DeviceRecord,
  result: ConnectionTestResult,
  ipAddress: string,
  port: number,
  reason: string,
): Promise<ReconnectOutcome> {
  const wasOnline = state.phase === 'online';
  const moved = ipAddress !== record.ip_address || port !== record.port;
  if (moved) {
    await updateDeviceAddress(record.id, ipAddress, port);
    console.log(`[Device] Paired machine found at new address ${ipAddress}:${port} (was ${record.ip_address}:${record.port})`);
  }

  let info: Partial<DeviceInfo> = {
    model: result.deviceInfo?.model,
    serialNumber: result.deviceInfo?.serialNumber,
    macAddress: result.deviceInfo?.macAddress,
    firmwareVersion: result.deviceInfo?.firmwareVersion,
    deviceTime: parseDeviceTime(result.deviceInfo?.deviceTime),
  };
  const refreshed = moved ? await getActiveDeviceRecord().catch(() => null) : record;
  if (refreshed && !wasOnline) {
    try {
      // Warms the cached adapter used by attendance sync and parses device time correctly.
      info = { ...info, ...(await getAdapterForDevice(refreshed).getDeviceInfo()) };
    } catch {
      /* testConnection already proved the login works */
    }
  }

  if (!wasOnline && record.password_encrypted) {
    try {
      const password = decryptPassword(record.password_encrypted);
      if (password) {
        void publishDeviceProfile({
          name: record.name,
          brand: record.brand,
          model: info.model ?? record.model ?? undefined,
          ipAddress,
          port,
          username: record.username ?? 'admin',
          password,
        });
      }
    } catch {
      /* this computer cannot unlock the saved password, so it is not shared */
    }
  }

  await updateConnectionMode(record.id, 'local_direct').catch(() => undefined);
  await updateDeviceMeta(record.id, {
    status: record.status === 'syncing' ? undefined : 'online',
    model: info.model,
    macAddress: info.macAddress,
    deviceTime: info.deviceTime,
  });

  const identity = savePairedIdentity(record.id, {
    serialNumber: info.serialNumber,
    macAddress: info.macAddress,
    model: info.model,
    firmwareVersion: info.firmwareVersion,
    ipAddress,
    port,
  });

  authFailedFingerprint = null;
  failures = 0;
  healthFailures = 0;
  lastVerifyAt = Date.now();
  applyRecord({ ...record, ip_address: ipAddress, port, model: info.model ?? record.model }, identity);
  setState({
    phase: 'online',
    message: `Connected to ${info.model ?? 'attendance machine'} at ${ipAddress}:${port}`,
    detail: null,
    attempt: 0,
    nextRetryAt: null,
    lastOnlineAt: new Date().toISOString(),
    candidates: [],
  });

  await refreshSyncScheduler().catch(() => undefined);
  if (!wasOnline) {
    console.log(`[Device] Connected (${reason}): ${ipAddress}:${port} ${info.model ?? ''}`.trim());
    if (record.auto_sync_enabled) {
      // Catch up on punches made while disconnected; duplicates are ignored by external_id.
      void syncDeviceAttendance()
        .then((r) => console.log(`[Device] Catch-up sync: downloaded=${r.downloaded} inserted=${r.inserted} duplicates=${r.duplicates}`))
        .catch((err) => console.info('[Device] Catch-up sync failed:', err instanceof Error ? err.message : err));
    }
  }
  return { connected: true, ipAddress, port, model: info.model };
}

async function markAuthFailed(record: DeviceRecord, detail: string): Promise<ReconnectOutcome> {
  authFailedFingerprint = credentialFingerprint(record);
  await setDbStatus(record, 'offline');
  const message =
    'The attendance machine rejected the saved username or password. Enter the correct device credentials and click Connect. Automatic retries are paused to avoid locking the machine.';
  setState({ phase: 'auth_failed', message, detail, nextRetryAt: null });
  return { connected: false, reason: 'authentication_failed', message };
}

async function markOffline(
  record: DeviceRecord,
  reason: 'device_unavailable' | 'no_local_network',
  message: string,
  detail?: string,
): Promise<ReconnectOutcome> {
  await setDbStatus(record, 'offline');
  setState({ phase: 'offline', message, detail: detail ?? null });
  return { connected: false, reason, message };
}

async function handleNotConfigured(opts: CycleOptions): Promise<ReconnectOutcome> {
  setState({
    phase: 'not_configured',
    deviceId: null,
    deviceName: null,
    ipAddress: null,
    port: null,
    model: null,
    serialNumber: null,
    macAddress: null,
    firmwareVersion: null,
    paired: false,
    message: 'No attendance machine is set up on this computer yet. Searching the local network…',
    detail: null,
  });
  const allowScan = Boolean(opts.force || opts.allowSubnetScan) || Date.now() - lastSubnetScanAt >= SUBNET_SCAN_MIN_GAP_MS;
  const discovery = await discoverDevices({ includeSubnetScan: allowScan, subnetScanOnlyIfSadpEmpty: true });
  if (discovery.subnetScanned) lastSubnetScanAt = Date.now();

  const compatible = discovery.devices.filter((d) => d.compatible);
  const candidates = compatible.length ? compatible : discovery.devices;
  let message: string;
  if (candidates.length === 1) {
    const c = candidates[0];
    message = `Found ${c.model} at ${c.ipAddress}. Enter the machine's username and password, then click Connect.`;
  } else if (candidates.length > 1) {
    message = `Found ${candidates.length} machines on the network. Select yours, enter its username and password, then click Connect.`;
  } else {
    message = discovery.message ?? 'No attendance machine was found on the local network.';
  }
  setState({
    phase: 'not_configured',
    message,
    candidates,
    discoveryAt: discovery.finishedAt,
    sadpAvailable: discovery.sadpAvailable,
  });
  return { connected: false, reason: 'no_device', message };
}

async function attempt(reason: string, opts: CycleOptions): Promise<ReconnectOutcome> {
  if (!env.deviceSyncEnabled) {
    const message = 'Device sync is disabled on this server';
    setState({ phase: 'disabled', message });
    return { connected: false, reason: 'sync_disabled', message };
  }

  let record = await getActiveDeviceRecord().catch(() => null);
  if (!record?.password_encrypted) {
    const imported = await pullHostedDeviceProfile();
    if (imported) record = await getActiveDeviceRecord().catch(() => null);
  }
  if (!record) return handleNotConfigured(opts);

  const identity = getPairedIdentity(record.id);
  applyRecord(record, identity);

  if (identity?.autoConnectPaused && !opts.force) {
    const message = 'Automatic connection is paused because the machine was disconnected. Click Connect or Retry now to resume.';
    setState({ phase: 'paused', message, nextRetryAt: null });
    return { connected: false, reason: 'paused', message };
  }
  if (identity?.autoConnectPaused && opts.force) setAutoConnectPaused(record.id, false);

  if (!record.password_encrypted) {
    const message = 'Enter the attendance machine username and password, then click Connect.';
    setState({ phase: 'needs_credentials', message, nextRetryAt: null });
    return { connected: false, reason: 'no_credentials', message };
  }

  let password: string;
  try {
    password = decryptPassword(record.password_encrypted);
  } catch {
    const message =
      'The saved machine password cannot be unlocked on this computer. Enter the machine password again and click Connect.';
    setState({ phase: 'needs_credentials', message, nextRetryAt: null });
    return { connected: false, reason: 'no_credentials', message };
  }

  if (authFailedFingerprint === credentialFingerprint(record) && !opts.force) {
    return { connected: false, reason: 'authentication_failed', message: state.message };
  }

  const verifyingOnline = state.phase === 'online' && state.deviceId === record.id;
  setState({ lastAttemptAt: new Date().toISOString() });
  if (!verifyingOnline) {
    setState({ phase: 'connecting', message: `Connecting to ${record.ip_address}:${record.port}…`, detail: null });
    await setDbStatus(record, 'connecting');
  }

  const saved = await verifyAt(record, password, record.ip_address, record.port, identity);
  if (saved.kind === 'ok') return markConnected(record, saved.result, record.ip_address, record.port, reason);
  if (saved.kind === 'auth_failed') return markAuthFailed(record, saved.message);

  const preferredSubnet = record.ip_address.split('.').slice(0, 3).join('.');
  if (getLocalNetworkInfo(preferredSubnet).subnets.length === 0) {
    return markOffline(
      record,
      'no_local_network',
      'This computer is not connected to a network. Reconnecting automatically when the network returns.',
    );
  }

  setState({
    phase: 'discovering',
    message:
      saved.kind === 'mismatch'
        ? 'A different machine answered at the saved address. Searching the local network for the paired machine…'
        : 'The machine did not respond at its saved address. Searching the local network…',
    detail: saved.message,
  });

  const allowScan =
    Boolean(opts.force || opts.allowSubnetScan) || Date.now() - lastSubnetScanAt >= SUBNET_SCAN_MIN_GAP_MS;
  const discovery = await discoverDevices({
    preferredSubnet,
    customPort: record.port,
    includeSubnetScan: allowScan,
    subnetScanOnlyIfSadpEmpty: true,
  });
  if (discovery.subnetScanned) lastSubnetScanAt = Date.now();
  setState({ discoveryAt: discovery.finishedAt, sadpAvailable: discovery.sadpAvailable });

  const candidates = rankCandidates(discovery.devices, record, identity);
  const successes: Array<{ c: DiscoveredDevice; result: ConnectionTestResult }> = [];
  for (const c of candidates) {
    const v = await verifyAt(record, password, c.ipAddress, c.port, identity);
    if (v.kind === 'ok') {
      successes.push({ c, result: v.result });
      if (identity && identityMatches(identity, c) === 'match') break;
      continue;
    }
    if (v.kind === 'auth_failed' && identity && identityMatches(identity, c) === 'match') {
      return markAuthFailed(record, `The paired machine at ${c.ipAddress}:${c.port} rejected the saved credentials.`);
    }
  }

  if (successes.length === 1) {
    const { c, result } = successes[0];
    return markConnected(record, result, c.ipAddress, c.port, reason);
  }
  if (successes.length > 1) {
    await setDbStatus(record, 'offline');
    const message =
      'Several machines on the network accept these credentials. Select the correct machine in Device Settings, then click Connect.';
    setState({
      phase: 'needs_selection',
      message,
      candidates: successes.map((s) => ({
        ...s.c,
        serialNumber: s.c.serialNumber ?? s.result.deviceInfo?.serialNumber,
        model: s.result.deviceInfo?.model ?? s.c.model,
      })),
      nextRetryAt: null,
    });
    return { connected: false, reason: 'needs_selection', message };
  }

  return markOffline(
    record,
    'device_unavailable',
    identity?.serialNumber
      ? 'The paired attendance machine was not found on the local network. Retrying automatically.'
      : 'The attendance machine was not found on the local network. Retrying automatically.',
    saved.message,
  );
}

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleCycle(delayMs: number, reason: string, opts: CycleOptions = {}): void {
  clearRetry();
  state.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void runCycle(reason, opts);
  }, delayMs);
  retryTimer.unref?.();
}

function stopHealth(): void {
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = null;
}

function ensureHealth(): void {
  if (healthTimer) return;
  healthTimer = setInterval(() => void healthTick(), HEALTH_INTERVAL_MS);
  healthTimer.unref?.();
}

function scheduleAfter(outcome: ReconnectOutcome): void {
  clearRetry();
  if (suspended) return;
  if (outcome.connected) {
    state.nextRetryAt = null;
    ensureHealth();
    return;
  }
  stopHealth();
  switch (outcome.reason) {
    case 'no_device':
      scheduleCycle(UNCONFIGURED_REDISCOVERY_MS, 'rediscover');
      return;
    case 'device_unavailable':
    case 'no_local_network':
    case 'not_hikvision': {
      failures += 1;
      const delay = BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)];
      state.attempt = failures;
      scheduleCycle(delay, 'retry');
      return;
    }
    default:
      // auth failure, missing credentials, paused, several matches: wait for the user.
      state.nextRetryAt = null;
  }
}

function runCycle(reason: string, opts: CycleOptions = {}): Promise<ReconnectOutcome> {
  if (inFlight) {
    return opts.force ? inFlight.then(() => runCycle(reason, opts)) : inFlight;
  }
  clearRetry();
  const run = withDeviceLock(() => attempt(reason, opts))
    .catch(async (err): Promise<ReconnectOutcome> => {
      const message = err instanceof Error ? err.message : String(err);
      console.info('[Device] Connection cycle failed:', message);
      const record = await getActiveDeviceRecord().catch(() => null);
      if (record) return markOffline(record, 'device_unavailable', 'Could not connect to the attendance machine. Retrying automatically.', message);
      return { connected: false, reason: 'device_unavailable', message };
    })
    .then((outcome) => {
      scheduleAfter(outcome);
      return outcome;
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = run;
  return run;
}

async function connectionLost(record: DeviceRecord, detail: string): Promise<void> {
  healthFailures = 0;
  failures = 0;
  stopHealth();
  await setDbStatus(record, 'offline');
  setState({ phase: 'offline', message: 'Lost connection to the attendance machine. Reconnecting…', detail });
  scheduleCycle(BACKOFF_MS[0], 'connection-lost');
}

async function healthTick(): Promise<void> {
  if (inFlight || suspended || state.phase !== 'online') return;
  const record = await getActiveDeviceRecord().catch(() => null);
  if (!record) {
    void runCycle('device-removed');
    return;
  }
  if (record.status === 'syncing') {
    healthFailures = 0;
    return;
  }
  if (record.status === 'offline') {
    await connectionLost(record, 'Attendance sync could not reach the machine');
    return;
  }
  const up = await tcpProbe(record.ip_address, record.port);
  if (!up) {
    healthFailures += 1;
    if (healthFailures >= 2) await connectionLost(record, `${record.ip_address}:${record.port} stopped responding`);
    return;
  }
  healthFailures = 0;
  if (Date.now() - lastVerifyAt >= VERIFY_INTERVAL_MS) {
    lastVerifyAt = Date.now();
    void runCycle('verify');
  }
}

/** Network change or wake-up: retry promptly instead of waiting out the backoff. */
function nudge(reason: string, delayMs: number): void {
  if (suspended) return;
  if (state.phase === 'online') {
    lastVerifyAt = 0;
    clearRetry();
    scheduleCycle(delayMs, reason);
    return;
  }
  if (['offline', 'connecting', 'discovering', 'not_configured'].includes(state.phase)) {
    failures = 0;
    scheduleCycle(delayMs, reason, { allowSubnetScan: true });
  }
}

function networkSignature(): string {
  const parts: string[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) parts.push(`${name}=${a.address}`);
    }
  }
  return parts.sort().join(',');
}

export function startAutoReconnectWatcher(): void {
  if (!env.deviceSyncEnabled || watchersStarted) return;
  watchersStarted = true;
  let signature = networkSignature();
  let lastTick = Date.now();
  networkTimer = setInterval(() => {
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;
    if (gap > NETWORK_POLL_MS * 4) {
      console.log('[Device] Clock jump detected (sleep/resume) — re-checking machine');
      suspended = false;
      nudge('wake', 5_000);
    }
    const next = networkSignature();
    if (next !== signature) {
      signature = next;
      console.log('[Device] Network change detected — re-checking machine');
      nudge('network-change', 3_000);
    }
  }, NETWORK_POLL_MS);
  networkTimer.unref?.();
}

export function stopAutoReconnectWatcher(): void {
  clearRetry();
  stopHealth();
  if (networkTimer) clearInterval(networkTimer);
  networkTimer = null;
  watchersStarted = false;
}

export function isAutoReconnectWatcherRunning(): boolean {
  return watchersStarted;
}

/** Startup: wait briefly for the database, then run the first cycle. */
export async function autoReconnectDevice(): Promise<void> {
  if (!env.deviceSyncEnabled) return;
  startAutoReconnectWatcher();
  for (const waitMs of [0, 3_000, 8_000]) {
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    if (await getActiveDeviceRecord().catch(() => null)) break;
  }
  const outcome = await runCycle('startup', { allowSubnetScan: true });
  console.info(`[Device] Startup connection: ${outcome.connected ? 'connected' : outcome.message}`);
}

function outcomeFromState(): ReconnectOutcome {
  if (state.phase === 'online' && state.ipAddress && state.port) {
    return { connected: true, ipAddress: state.ipAddress, port: state.port, model: state.model ?? undefined };
  }
  const reasons: Partial<Record<ConnectionPhase, Exclude<ReconnectOutcome, { connected: true }>['reason']>> = {
    auth_failed: 'authentication_failed',
    needs_credentials: 'no_credentials',
    not_configured: 'no_device',
    paused: 'paused',
    needs_selection: 'needs_selection',
    disabled: 'sync_disabled',
  };
  return { connected: false, reason: reasons[state.phase] ?? 'device_unavailable', message: state.message };
}

/**
 * Explicit request (Device Settings "Retry now", login, window focus, database recovery).
 * Non-forced requests right after an attempt reuse its result so UI events cannot
 * bypass the backoff.
 */
export function tryReconnectOnce(opts: { force?: boolean } = {}): Promise<ReconnectOutcome> {
  if (!opts.force && !inFlight && state.lastAttemptAt && Date.now() - Date.parse(state.lastAttemptAt) < REQUEST_MIN_GAP_MS) {
    return Promise.resolve(outcomeFromState());
  }
  return runCycle(opts.force ? 'user-retry' : 'request', { force: opts.force, allowSubnetScan: opts.force });
}

/** Device settings saved (possibly new address or credentials): connect automatically. */
export function notifyDeviceConfigChanged(deviceId?: string): Promise<ReconnectOutcome> {
  authFailedFingerprint = null;
  failures = 0;
  if (deviceId) setAutoConnectPaused(deviceId, false);
  return runCycle('config-changed', { allowSubnetScan: false });
}

/** A manual Connect succeeded: record the identity without logging in again. */
export async function notifyDeviceConnected(record: DeviceRecord, info: DeviceInfo): Promise<void> {
  const identity = savePairedIdentity(record.id, {
    serialNumber: info.serialNumber,
    macAddress: info.macAddress,
    model: info.model,
    firmwareVersion: info.firmwareVersion,
    ipAddress: record.ip_address,
    port: record.port,
  });
  authFailedFingerprint = null;
  failures = 0;
  healthFailures = 0;
  lastVerifyAt = Date.now();
  clearRetry();
  applyRecord(record, identity);
  setState({
    phase: 'online',
    message: `Connected to ${info.model ?? 'attendance machine'} at ${record.ip_address}:${record.port}`,
    detail: null,
    attempt: 0,
    nextRetryAt: null,
    lastOnlineAt: new Date().toISOString(),
    candidates: [],
  });
  ensureHealth();
}

/** A manual Connect failed: reflect it without another login attempt. */
export async function notifyConnectFailed(record: DeviceRecord | null, authFailed: boolean, detail: string): Promise<void> {
  if (!record) return;
  applyRecord(record, getPairedIdentity(record.id));
  if (authFailed) {
    await markAuthFailed(record, detail);
    clearRetry();
    return;
  }
  failures = 0;
  setState({ phase: 'offline', message: 'Could not reach the attendance machine. Retrying automatically.', detail });
  scheduleAfter({ connected: false, reason: 'device_unavailable', message: detail });
}

/** User pressed Disconnect: stop automatic connection until they reconnect. */
export function notifyManualDisconnect(record: DeviceRecord): void {
  setAutoConnectPaused(record.id, true);
  clearRetry();
  stopHealth();
  setState({
    phase: 'paused',
    message: 'Disconnected. Automatic connection is paused until you click Connect or Retry now.',
    nextRetryAt: null,
  });
}

export function handleSystemSuspend(): void {
  suspended = true;
  clearRetry();
  state.nextRetryAt = null;
}

export function handleSystemResume(): void {
  suspended = false;
  nudge('resume', 5_000);
}

export function getConnectionState(): DeviceConnectionState & { busy: boolean } {
  return { ...state, busy: Boolean(inFlight) };
}
