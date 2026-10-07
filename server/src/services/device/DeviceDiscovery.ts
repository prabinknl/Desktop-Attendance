/**
 * LAN discovery of Hikvision attendance terminals.
 *
 * 1. SADP multicast inquiry — fast, returns serial number / MAC / model.
 * 2. ISAPI subnet scan (existing NetworkScanner) — slower fallback when SADP is
 *    blocked (firewall) or the device does not answer it.
 *
 * Discovery only lists candidates. A candidate is never treated as "the"
 * machine until it authenticates with the saved credentials and, when a paired
 * identity exists, reports the same serial number.
 */
import { discoverSadp, normalizeMac } from './SadpDiscovery.js';
import { scanNetwork, getLocalNetworkInfo } from './NetworkScanner.js';
import { logDeviceAction } from './deviceLogger.js';
import type { DiscoveredDevice } from '../../types/index.js';

export interface DiscoveryOptions {
  preferredSubnet?: string;
  customPort?: number;
  /** Also run the slower ISAPI subnet scan. */
  includeSubnetScan?: boolean;
  /** Skip the subnet scan when SADP already found a compatible terminal. */
  subnetScanOnlyIfSadpEmpty?: boolean;
}

export interface DiscoveryResult {
  devices: DiscoveredDevice[];
  discoveryAvailable: boolean;
  sadpAvailable: boolean;
  subnetScanned: boolean;
  message?: string;
  finishedAt: string;
}

/** DS-K… is Hikvision's access-control / attendance terminal family (e.g. DS-K1T320EFWX). */
export function isCompatibleModel(model?: string | null): boolean {
  return /^DS-K/i.test(String(model ?? '').trim());
}

function mergeDevice(into: Map<string, DiscoveredDevice>, device: DiscoveredDevice): void {
  const key = `${device.ipAddress}:${device.port}`;
  const existing = into.get(key);
  if (!existing) {
    into.set(key, device);
    return;
  }
  const genericModel = /^Hikvision \(ISAPI\)$/i.test(existing.model);
  into.set(key, {
    ...existing,
    model: genericModel ? device.model : existing.model,
    macAddress: existing.macAddress || device.macAddress,
    serialNumber: existing.serialNumber || device.serialNumber,
    firmwareVersion: existing.firmwareVersion || device.firmwareVersion,
    activated: existing.activated ?? device.activated,
    compatible: Boolean(existing.compatible || device.compatible),
    discoveredBy: [...new Set([...(existing.discoveredBy ?? []), ...(device.discoveredBy ?? [])])],
  });
}

async function runDiscovery(opts: DiscoveryOptions): Promise<DiscoveryResult> {
  const netInfo = getLocalNetworkInfo(opts.preferredSubnet);
  if (netInfo.subnets.length === 0) {
    return {
      devices: [],
      discoveryAvailable: false,
      sadpAvailable: false,
      subnetScanned: false,
      message: 'This computer is not connected to a local network. Connect to Wi-Fi or LAN and try again.',
      finishedAt: new Date().toISOString(),
    };
  }

  const merged = new Map<string, DiscoveredDevice>();
  const sadp = await discoverSadp({ timeoutMs: 3_000, repeats: 2 });
  for (const d of sadp.devices) {
    mergeDevice(merged, {
      brand: 'hikvision',
      model: d.model || 'Hikvision device',
      ipAddress: d.ipAddress,
      port: d.httpPort ?? 80,
      macAddress: normalizeMac(d.macAddress),
      serialNumber: d.serialNumber,
      firmwareVersion: d.firmwareVersion,
      activated: d.activated,
      compatible: isCompatibleModel(d.model),
      status: 'reachable',
      discoveredBy: ['sadp'],
    });
  }

  const sadpHasCompatible = [...merged.values()].some((d) => d.compatible);
  const runScan =
    Boolean(opts.includeSubnetScan) && !(opts.subnetScanOnlyIfSadpEmpty && sadpHasCompatible);
  if (runScan) {
    const scan = await scanNetwork(opts.preferredSubnet, opts.customPort);
    for (const d of scan.devices) {
      mergeDevice(merged, {
        ...d,
        macAddress: normalizeMac(d.macAddress),
        compatible: isCompatibleModel(d.model),
        discoveredBy: ['isapi'],
      });
    }
  }

  const devices = [...merged.values()].sort(
    (a, b) => Number(Boolean(b.compatible)) - Number(Boolean(a.compatible)),
  );
  logDeviceAction({
    action: 'discover',
    result: 'ok',
    message: `sadp=${sadp.available ? sadp.devices.length : 'unavailable'} subnetScan=${runScan} found=${devices.length}`,
  });

  let message: string | undefined;
  if (devices.length === 0) {
    message = sadp.available
      ? 'No Hikvision attendance machine was found on the local network. Check that the machine is powered on and on the same network, or enter its IP address manually.'
      : 'Automatic discovery is limited on this computer (the network or firewall blocked it). Enter the machine IP address manually, or allow Attendance Desktop through Windows Firewall on private networks.';
  }

  return {
    devices,
    discoveryAvailable: true,
    sadpAvailable: sadp.available,
    subnetScanned: runScan,
    message,
    finishedAt: new Date().toISOString(),
  };
}

let inFlight: { promise: Promise<DiscoveryResult>; includesScan: boolean } | null = null;
let lastResult: DiscoveryResult | null = null;

/** Overlapping requests share one discovery run instead of flooding the LAN. */
export async function discoverDevices(opts: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  const wantsScan = Boolean(opts.includeSubnetScan);
  if (inFlight && (inFlight.includesScan || !wantsScan)) return inFlight.promise;
  if (inFlight) await inFlight.promise.catch(() => undefined);

  const promise = runDiscovery(opts).then((result) => {
    lastResult = result;
    return result;
  });
  inFlight = { promise, includesScan: wantsScan };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

export function getLastDiscovery(): DiscoveryResult | null {
  return lastResult;
}
