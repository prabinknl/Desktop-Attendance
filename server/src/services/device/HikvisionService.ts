import http from 'http';
import https from 'https';
import net from 'net';
import crypto from 'crypto';
import type { IDeviceAdapter, DeviceConnectionConfig } from './IDeviceAdapter.js';
import { logDeviceAction } from './deviceLogger.js';
import type {
  ConnectionTestResult,
  DeviceAttendanceEvent,
  DeviceInfo,
} from '../../types/index.js';

const REQUEST_TIMEOUT_MS = 12_000;
/** Fast TCP check before any AcsEvent variant probing. */
const REACHABILITY_TIMEOUT_MS = 1_500;
/** Many terminals cap AcsEvent maxResults at 10–30; keep pages small for compatibility. */
const PAGE_SIZE = 20;
const MAX_PAGES = 100;

/** True when the physical device is offline / unreachable (do not probe more variants). */
export function isDeviceUnreachableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code === 'DEVICE_UNREACHABLE') return true;
  const msg = String(e.message ?? '');
  if (/Request timeout|did not respond/i.test(msg)) return true;
  if (
    e.code === 'ECONNREFUSED' ||
    e.code === 'ENOTFOUND' ||
    e.code === 'EHOSTUNREACH' ||
    e.code === 'ENETUNREACH' ||
    e.code === 'ETIMEDOUT' ||
    e.code === 'ECONNRESET' ||
    e.code === 'EPIPE'
  ) {
    return true;
  }
  return /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ECONNRESET/i.test(msg);
}

function deviceUnreachableError(message: string, cause?: unknown): Error {
  return Object.assign(new Error(message), {
    code: 'DEVICE_UNREACHABLE' as const,
    cause,
  });
}

/** Quick TCP connect — fails in ~1.5s when the machine is off the network. */
function probeTcpPort(host: string, port: number, timeoutMs = REACHABILITY_TIMEOUT_MS): Promise<boolean> {
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

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 4, keepAliveMsecs: 30_000 });
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 4,
  keepAliveMsecs: 30_000,
  rejectUnauthorized: false,
});

/** Parse WWW-Authenticate header for digest auth parameters. */
function parseDigestHeader(header: string): Record<string, string> {
  const params: Record<string, string> = {};
  const regex = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[2] ?? match[3] ?? '';
  }
  return params;
}

function pickWwwAuthenticate(headers: http.IncomingHttpHeaders): string | undefined {
  const raw = headers['www-authenticate'];
  if (!raw) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  return values.find((v) => /digest/i.test(v)) ?? values.find((v) => /basic/i.test(v)) ?? values[0];
}

type DigestEncoding = 'utf8' | 'latin1';
type DigestAlgMode = 'omit' | 'raw' | 'quoted';

/** Cache which Digest auth variant works per device so every ISAPI call is not a multi-try probe. */
const digestVariantCache = new Map<
  string,
  { encoding: DigestEncoding; algorithmMode: DigestAlgMode; uriMode: 'path' | 'absolute'; label: string }
>();

/** Build digest authorization header (MD5 / MD5-sess). */
function buildDigestAuth(
  method: string,
  uri: string,
  username: string,
  password: string,
  params: Record<string, string>,
  opts: { encoding?: DigestEncoding; algorithmMode?: DigestAlgMode } = {},
): string {
  const encoding = opts.encoding ?? 'utf8';
  const algorithmMode = opts.algorithmMode ?? 'omit';
  const realm = params.realm ?? '';
  const nonce = params.nonce ?? '';
  const qopRaw = (params.qop ?? '').trim();
  const qop = qopRaw
    ? (qopRaw.split(',').map((q) => q.trim()).find((q) => /^auth$/i.test(q))
      ?? qopRaw.split(',')[0].trim())
    : '';
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const md5 = (s: string) => crypto.createHash('md5').update(s, encoding).digest('hex');

  let ha1 = md5(`${username}:${realm}:${password}`);
  if (/md5-sess/i.test(params.algorithm ?? '')) {
    ha1 = md5(`${ha1}:${nonce}:${cnonce}`);
  }
  const ha2 = md5(`${method}:${uri}`);

  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (algorithmMode === 'raw' && params.algorithm) {
    parts.push(`algorithm=${params.algorithm}`);
  } else if (algorithmMode === 'quoted' && params.algorithm) {
    parts.push(`algorithm="${params.algorithm}"`);
  }
  if (qop) {
    parts.push(`qop=${qop}`);
    parts.push(`nc=${nc}`);
    parts.push(`cnonce="${cnonce}"`);
  }
  if (params.opaque) parts.push(`opaque="${params.opaque}"`);

  return `Digest ${parts.join(', ')}`;
}

function buildBasicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

interface IsapiResponse {
  status: number;
  body: string;
  latencyMs: number;
  headers: http.IncomingHttpHeaders;
}

type RequestResult = {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
};

function rawIsapiRequest(
  config: DeviceConnectionConfig,
  method: string,
  apiPath: string,
  authHeader?: string,
  body?: string,
  contentType = 'application/xml',
): Promise<RequestResult> {
  const useHttps = config.port === 443 || config.useHttps === true;
  const transport = useHttps ? https : http;

  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: config.ipAddress,
      port: config.port,
      path: apiPath,
      method,
      timeout: REQUEST_TIMEOUT_MS,
      agent: useHttps ? httpsAgent : httpAgent,
      headers: {
        Accept: 'application/json, application/xml, */*',
        Connection: 'keep-alive',
        ...(body
          ? { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) }
          : {}),
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      ...(useHttps ? { rejectUnauthorized: false } : {}),
    } as http.RequestOptions;

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }),
      );
    });
    req.on('error', (err) => {
      reject(deviceUnreachableError(err.message || 'Device network error', err));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(deviceUnreachableError('Request timeout — device did not respond'));
    });
    if (body) req.write(body);
    req.end();
  });
}

/**
 * HTTP/HTTPS with Hikvision-compatible Digest (+ Basic) auth.
 * Tries several Digest variants because DS-K1T firmwares differ.
 */
async function isapiRequest(
  config: DeviceConnectionConfig,
  method: string,
  apiPath: string,
  body?: string,
  contentType = 'application/xml',
): Promise<IsapiResponse> {
  const start = Date.now();
  const username = String(config.username ?? '').trim() || 'admin';
  const password = String(config.password ?? '');
  const cacheKey = `${config.ipAddress}:${config.port}`;

  let response = await rawIsapiRequest(config, method, apiPath, undefined, body, contentType);

  if (response.status === 401) {
    const firstChallenge = pickWwwAuthenticate(response.headers);
    if (!firstChallenge) {
      throw Object.assign(new Error('Authentication failed — device rejected credentials'), {
        code: 'AUTH_FAILED',
        status: 401,
      });
    }

    const useHttps = config.port === 443 || config.useHttps === true;
    const absoluteUri = `${useHttps ? 'https' : 'http'}://${config.ipAddress}:${config.port}${apiPath}`;

    const digestVariants: Array<{
      label: string;
      encoding: DigestEncoding;
      algorithmMode: DigestAlgMode;
      uri: string;
      uriMode: 'path' | 'absolute';
    }> = [
      { label: 'digest-utf8-omit-alg', encoding: 'utf8', algorithmMode: 'omit', uri: apiPath, uriMode: 'path' },
      { label: 'digest-utf8-raw-alg', encoding: 'utf8', algorithmMode: 'raw', uri: apiPath, uriMode: 'path' },
      { label: 'digest-latin1-omit-alg', encoding: 'latin1', algorithmMode: 'omit', uri: apiPath, uriMode: 'path' },
      { label: 'digest-utf8-abs-uri', encoding: 'utf8', algorithmMode: 'omit', uri: absoluteUri, uriMode: 'absolute' },
      { label: 'digest-utf8-quoted-alg', encoding: 'utf8', algorithmMode: 'quoted', uri: apiPath, uriMode: 'path' },
    ];

    const tryDigest = async (
      variant: (typeof digestVariants)[number],
      challengeHeader: string,
    ): Promise<RequestResult> => {
      const params = parseDigestHeader(challengeHeader);
      const digest = buildDigestAuth(method, variant.uri, username, password, params, {
        encoding: variant.encoding,
        algorithmMode: variant.algorithmMode,
      });
      return rawIsapiRequest(config, method, apiPath, digest, body, contentType);
    };

    if (/digest/i.test(firstChallenge)) {
      const cached = digestVariantCache.get(cacheKey);
      if (cached) {
        const cachedVariant =
          digestVariants.find((v) => v.label === cached.label) ??
          ({
            label: cached.label,
            encoding: cached.encoding,
            algorithmMode: cached.algorithmMode,
            uri: cached.uriMode === 'absolute' ? absoluteUri : apiPath,
            uriMode: cached.uriMode,
          } as (typeof digestVariants)[number]);
        response = await tryDigest(cachedVariant, firstChallenge);
        if (response.status !== 401) {
          return { ...response, latencyMs: Date.now() - start };
        }
      }

      for (const variant of digestVariants) {
        if (cached?.label === variant.label) continue;
        const challengeRes = await rawIsapiRequest(config, method, apiPath, undefined, body, contentType);
        if (challengeRes.status !== 401) {
          response = challengeRes;
          break;
        }
        const challenge = pickWwwAuthenticate(challengeRes.headers);
        if (!challenge || !/digest/i.test(challenge)) break;
        response = await tryDigest(variant, challenge);
        if (response.status !== 401) {
          digestVariantCache.set(cacheKey, {
            encoding: variant.encoding,
            algorithmMode: variant.algorithmMode,
            uriMode: variant.uriMode,
            label: variant.label,
          });
          logDeviceAction({
            ip: config.ipAddress,
            action: 'isapiAuth',
            result: 'ok',
            message: variant.label,
          });
          break;
        }
      }
    }

    if (response.status === 401) {
      response = await rawIsapiRequest(
        config,
        method,
        apiPath,
        buildBasicAuth(username, password),
        body,
        contentType,
      );
      if (response.status !== 401) {
        logDeviceAction({
          ip: config.ipAddress,
          action: 'isapiAuth',
          result: 'ok',
          message: 'basic',
        });
      }
    }

    if (response.status === 401) {
      digestVariantCache.delete(cacheKey);
      throw Object.assign(
        new Error(
          'Authentication failed — invalid username or password. ' +
            'Open http://' +
            config.ipAddress +
            ' in your browser, confirm admin login works, then type that exact password here (do not leave blank).',
        ),
        { code: 'AUTH_FAILED', status: 401 },
      );
    }
  }

  return { ...response, latencyMs: Date.now() - start };
}

function xmlTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
  return match?.[1]?.trim();
}

function pad2(n: number): string {
  return String(Math.abs(n)).padStart(2, '0');
}

/** Local wall-clock without timezone — preferred by many DS-K1T firmwares. */
function formatLocalNoTz(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** Local wall-clock with numeric offset (e.g. +05:45). */
function formatLocalWithOffset(date: Date): string {
  const base = formatLocalNoTz(date);
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const oh = pad2(Math.floor(Math.abs(offsetMin) / 60));
  const om = pad2(Math.abs(offsetMin) % 60);
  return `${base}${sign}${oh}:${om}`;
}

/** UTC with Z suffix. */
function formatUtcZ(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** UTC without Z (legacy). */
function formatUtcNoZ(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '');
}

type TimeFormatName = 'local' | 'offset' | 'utcZ' | 'utcNoZ';

function formatHikvisionTime(date: Date, style: TimeFormatName = 'local'): string {
  switch (style) {
    case 'offset':
      return formatLocalWithOffset(date);
    case 'utcZ':
      return formatUtcZ(date);
    case 'utcNoZ':
      return formatUtcNoZ(date);
    default:
      return formatLocalNoTz(date);
  }
}

/** searchID is limited to ~20 chars on many AcsEvent capabilities docs. */
function makeSearchId(): string {
  return `s${Date.now().toString(36)}`.slice(0, 16);
}

function extractIsapiError(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as {
      statusString?: string;
      subStatusCode?: string;
      errorMsg?: string;
      statusCode?: number | string;
    };
    const parts = [parsed.statusString, parsed.subStatusCode, parsed.errorMsg]
      .filter(Boolean)
      .map(String);
    if (parts.length) return parts.join(' / ');
  } catch {
    // fall through to XML tags
  }
  return (
    xmlTag(body, 'statusString') ??
    xmlTag(body, 'subStatusCode') ??
    xmlTag(body, 'errorMsg') ??
    undefined
  );
}

function parseDeviceTime(value?: string): Date | undefined {
  if (!value) return undefined;
  // Hikvision localTime often looks like 2026-07-15T14:30:00+05:45 or without offset
  const normalized = (value.includes('T') ? value : value.replace(' ', 'T')).trim();

  // Explicit timezone / Z — trust the device string
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  // No timezone: device wall-clock in Nepal (attendance machines are local).
  // Parsing as UTC on the server previously shifted punches onto the wrong BS day.
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(normalized);
  if (m) {
    const withOffset = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+05:45`;
    const d = new Date(withOffset);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Map machine attendanceStatus to check type.
 * Hikvision ISAPI uses strings (checkIn/checkOut/…) or numeric statusValue:
 * 0=checkIn, 1=checkOut, 2=breakOut, 3=breakIn, 4=overtimeIn, 5=overTimeOut.
 * Never treat bare "1" as check-in — that dropped morning punches when evening was "1".
 */
function mapAttendanceStatus(status?: string | number): DeviceAttendanceEvent['checkType'] {
  if (status === undefined || status === null || status === '') return 'punch';
  const s = String(status).toLowerCase().trim();
  if (s === 'undefined' || s === 'unknown') return 'punch';

  // Numeric attendanceStatusValue (Hikvision T&A)
  if (s === '0') return 'check_in';
  if (s === '1') return 'check_out';
  if (s === '2' || s === '3' || s === '4' || s === '5') return 'punch';

  if (
    s === 'checkin' ||
    s === 'check_in' ||
    s.includes('checkin') ||
    s.includes('check in') ||
    s === 'entry'
  ) {
    return 'check_in';
  }
  if (
    s === 'checkout' ||
    s === 'check_out' ||
    s.includes('checkout') ||
    s.includes('check out') ||
    s === 'exit'
  ) {
    return 'check_out';
  }
  return 'punch';
}

function mapAuthMethod(item: Record<string, unknown>): string | undefined {
  const type =
    item.currentVerifyMode ??
    item.type ??
    item.attendanceMethod ??
    item.cardType ??
    item.authenticationType;
  if (type === undefined || type === null) return undefined;
  return String(type);
}

/** Drop failed/anonymous ACS events — not real attendance punches. */
function isValidAttendanceEvent(event: DeviceAttendanceEvent): boolean {
  const id = String(event.employeeId ?? '').trim().toLowerCase();
  if (!id || id === 'unknown' || id === '—' || id === '-') return false;

  const name = String(event.employeeName ?? '').trim().toLowerCase();
  if (name === 'unknown') return false;

  const auth = String(event.authMethod ?? '').trim().toLowerCase();
  if (auth === 'invalid' || auth === 'none' || auth === 'unauthorized') return false;

  return true;
}

function buildExternalId(
  deviceSerial: string | undefined,
  item: Record<string, unknown>,
): string {
  const serialNo = item.serialNo ?? item.serialNumber;
  const employee = item.employeeNoString ?? item.employeeNo ?? item.cardNo ?? 'unknown';
  const time = item.time ?? '';
  const major = item.major ?? item.majorEventType ?? '';
  const minor = item.minor ?? item.subEventType ?? item.minorEventType ?? '';
  const parts = [
    deviceSerial ?? 'dev',
    serialNo !== undefined && serialNo !== null && serialNo !== ''
      ? String(serialNo)
      : `${employee}-${time}-${major}-${minor}`,
  ];
  return parts.join(':');
}

type AcsInfo = Record<string, unknown>;

/**
 * Hikvision ISAPI adapter for access-control terminals (e.g. DS-K1T320EFWX).
 * Uses HTTP Digest auth against /ISAPI/* endpoints. No mock/demo data.
 */
export class HikvisionService implements IDeviceAdapter {
  readonly brand = 'hikvision' as const;
  private connected = false;
  private deviceSerial?: string;
  /** Remember which AcsEvent request shape worked for this device session. */
  private acsEventStrategy?: {
    name: string;
    path: string;
    contentType: string;
    timeStyle: TimeFormatName;
    maxResults: number;
    major: number;
    includeMinor0: boolean;
    eventAttribute?: string;
  };

  constructor(private readonly config: DeviceConnectionConfig) {}

  async connect(): Promise<void> {
    const result = await this.testConnection();
    if (!result.online) {
      throw new Error(result.message);
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const tryOnce = async (cfg: DeviceConnectionConfig): Promise<ConnectionTestResult> => {
      try {
        const { status, body, latencyMs } = await isapiRequest(
          cfg,
          'GET',
          '/ISAPI/System/deviceInfo',
        );

        if (status === 401) {
          return {
            online: false,
            authState: 'authentication_failed',
            latencyMs,
            message: 'Authentication failed — device rejected username or password',
            fromRealDevice: true,
          };
        }

        if (status !== 200) {
          return {
            online: false,
            authState: 'reachable',
            latencyMs,
            message: `Device responded but deviceInfo failed (HTTP ${status})`,
            fromRealDevice: true,
          };
        }

        const model = xmlTag(body, 'model') ?? cfg.model;
        const serialNumber = xmlTag(body, 'serialNumber');
        this.deviceSerial = serialNumber;
        const firmwareVersion = xmlTag(body, 'firmwareVersion');
        let deviceTime = xmlTag(body, 'deviceTime') ?? xmlTag(body, 'localTime');

        try {
          const timeRes = await isapiRequest(cfg, 'GET', '/ISAPI/System/time');
          if (timeRes.status === 200) {
            deviceTime =
              xmlTag(timeRes.body, 'localTime') ??
              xmlTag(timeRes.body, 'time') ??
              deviceTime;
          }
        } catch {
          // optional
        }

        return {
          online: true,
          authState: 'authenticated',
          latencyMs,
          message: 'Authenticated with Hikvision device successfully',
          fromRealDevice: true,
          deviceInfo: {
            model,
            serialNumber,
            firmwareVersion,
            deviceTime: deviceTime ?? undefined,
            macAddress: xmlTag(body, 'macAddress'),
          },
        };
      } catch (err) {
        const code = (err as { code?: string }).code;
        const isAuth = code === 'AUTH_FAILED';
        const message = err instanceof Error ? err.message : 'Connection failed';
        return {
          online: false,
          authState: isAuth ? 'authentication_failed' : 'offline',
          latencyMs: 0,
          message,
          fromRealDevice: isAuth,
        };
      }
    };

    // Prefer configured port; if auth fails on HTTP 80, also try HTTPS 443
    let result = await tryOnce(this.config);
    if (
      !result.online
      && result.authState === 'authentication_failed'
      && this.config.port === 80
      && this.config.useHttps !== true
    ) {
      const httpsTry = await tryOnce({
        ...this.config,
        port: 443,
        useHttps: true,
      });
      if (httpsTry.online) {
        logDeviceAction({
          ip: this.config.ipAddress,
          action: 'testConnection',
          result: 'ok',
          message: 'authenticated via https:443',
        });
        return httpsTry;
      }
    }

    logDeviceAction({
      ip: this.config.ipAddress,
      action: 'testConnection',
      result: result.online ? 'ok' : result.authState === 'authentication_failed' ? 'auth_failed' : 'unreachable',
      message: result.message,
    });
    return result;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const { status, body } = await isapiRequest(this.config, 'GET', '/ISAPI/System/deviceInfo');
    if (status === 401) {
      throw Object.assign(new Error('Authentication failed'), { code: 'AUTH_FAILED' });
    }
    if (status !== 200) throw new Error(`Failed to fetch device info (HTTP ${status})`);

    let timeStr = xmlTag(body, 'localTime') ?? xmlTag(body, 'deviceTime');
    try {
      const timeRes = await isapiRequest(this.config, 'GET', '/ISAPI/System/time');
      if (timeRes.status === 200) {
        timeStr = xmlTag(timeRes.body, 'localTime') ?? xmlTag(timeRes.body, 'time') ?? timeStr;
      }
    } catch {
      // optional
    }

    const serialNumber = xmlTag(body, 'serialNumber');
    this.deviceSerial = serialNumber;

    return {
      model: xmlTag(body, 'model') ?? 'Unknown',
      serialNumber,
      firmwareVersion: xmlTag(body, 'firmwareVersion'),
      deviceTime: parseDeviceTime(timeStr),
      macAddress: xmlTag(body, 'macAddress'),
    };
  }

  async getAttendanceLogs(since?: Date, until?: Date): Promise<DeviceAttendanceEvent[]> {
    return this.syncAttendance(since, until);
  }

  /**
   * Download access-control events via ISAPI AcsEvent search.
   * Paginates until exhausted or MAX_PAGES.
   */
  async syncAttendance(since?: Date, until?: Date): Promise<DeviceAttendanceEvent[]> {
    const start = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = until ?? new Date();
    const all: DeviceAttendanceEvent[] = [];

    // Fail fast when the machine is off the LAN — never walk AcsEvent variants.
    const reachable = await probeTcpPort(this.config.ipAddress, this.config.port);
    if (!reachable) {
      const err = deviceUnreachableError(
        `Device ${this.config.ipAddress}:${this.config.port} is not reachable on the network`,
      );
      logDeviceAction({
        ip: this.config.ipAddress,
        action: 'syncAttendance',
        result: 'error',
        message: err.message,
      });
      throw err;
    }

    if (!this.deviceSerial) {
      try {
        const info = await this.getDeviceInfo();
        this.deviceSerial = info.serialNumber;
      } catch (err) {
        if (isDeviceUnreachableError(err)) throw err;
        // continue without serial
      }
    }

    let position = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { events, totalMatches, responseStatus } = await this.fetchAcsEventPage(
        start,
        end,
        position,
      );
      const valid = events.filter(isValidAttendanceEvent);
      all.push(...valid);

      // Advance by raw page size so we do not re-fetch the same device page
      if (events.length === 0) break;
      position += events.length;
      const pageSize = this.acsEventStrategy?.maxResults ?? PAGE_SIZE;
      if (totalMatches !== undefined && position >= totalMatches) break;
      if (responseStatus === 'NO MATCH' || responseStatus === 'NO MATCHES') break;
      if (events.length < pageSize) break;
      // Do not stop on responseStatus "OK" alone — some firmware returns OK on every page
    }

    logDeviceAction({
      ip: this.config.ipAddress,
      action: 'syncAttendance',
      result: 'ok',
      message: `events=${all.length} range=${start.toISOString()}..${end.toISOString()}`,
    });

    return all;
  }

  /** Diagnostic snapshot from the live device — includes AcsEvent probe results. */
  async diagnose(since?: Date, until?: Date): Promise<{
    fromRealDevice: boolean;
    model?: string;
    serialNumber?: string;
    firmwareVersion?: string;
    deviceTime?: string;
    macAddress?: string;
    rawEventCount: number;
    firstEventTime?: string;
    lastEventTime?: string;
    capabilitiesSnippet?: string;
    probeAttempts?: Array<{ name: string; status: number; error?: string; bodyPreview?: string }>;
  }> {
    const info = await this.getDeviceInfo();
    let capabilitiesSnippet: string | undefined;
    try {
      const cap = await isapiRequest(
        this.config,
        'GET',
        '/ISAPI/AccessControl/AcsEvent/capabilities?format=json',
      );
      capabilitiesSnippet = cap.body.slice(0, 1500);
    } catch {
      try {
        const cap = await isapiRequest(
          this.config,
          'GET',
          '/ISAPI/AccessControl/AcsEvent/capabilities',
        );
        capabilitiesSnippet = cap.body.slice(0, 1500);
      } catch {
        // optional
      }
    }

    const start = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = until ?? new Date();
    const probeAttempts = await this.probeAcsEventAttempts(start, end, 0);

    let events: DeviceAttendanceEvent[] = [];
    try {
      events = await this.syncAttendance(since, until);
    } catch {
      // probe still returned below
    }
    const sorted = [...events].sort((a, b) => a.eventTime.getTime() - b.eventTime.getTime());
    return {
      fromRealDevice: true,
      model: info.model,
      serialNumber: info.serialNumber,
      firmwareVersion: info.firmwareVersion,
      deviceTime: info.deviceTime?.toISOString(),
      macAddress: info.macAddress,
      rawEventCount: events.length,
      firstEventTime: sorted[0]?.eventTime.toISOString(),
      lastEventTime: sorted[sorted.length - 1]?.eventTime.toISOString(),
      capabilitiesSnippet,
      probeAttempts,
    };
  }

  private buildAcsAttempts(
    start: Date,
    end: Date,
    position: number,
  ): Array<{
    name: string;
    path: string;
    contentType: string;
    body: string;
    timeStyle: TimeFormatName;
    maxResults: number;
    major: number;
    includeMinor0: boolean;
    eventAttribute?: string;
  }> {
    const searchId = makeSearchId();
    const attempts: Array<{
      name: string;
      path: string;
      contentType: string;
      body: string;
      timeStyle: TimeFormatName;
      maxResults: number;
      major: number;
      includeMinor0: boolean;
      eventAttribute?: string;
    }> = [];

    const prioritized: Array<{
      name: string;
      timeStyle: TimeFormatName;
      maxResults: number;
      major: number;
      includeMinor0?: boolean;
      minor?: number;
      eventAttribute?: string;
      searchIdOverride?: string;
    }> = [
      { name: 'json-m5-local', timeStyle: 'local', maxResults: 30, major: 5 },
      {
        name: 'json-m5-local-sid1',
        timeStyle: 'local',
        maxResults: 30,
        major: 5,
        searchIdOverride: '1',
      },
      { name: 'json-m0-minor0-local', timeStyle: 'local', maxResults: 30, major: 0, includeMinor0: true },
      { name: 'json-m5-minor0-local', timeStyle: 'local', maxResults: 30, major: 5, includeMinor0: true },
      { name: 'json-m5-local-max10', timeStyle: 'local', maxResults: 10, major: 5 },
      { name: 'json-face75-local', timeStyle: 'local', maxResults: 30, major: 5, minor: 75 },
      { name: 'json-m5-offset', timeStyle: 'offset', maxResults: 30, major: 5 },
      { name: 'json-m0-minor0-offset', timeStyle: 'offset', maxResults: 30, major: 0, includeMinor0: true },
      { name: 'json-attendance-local', timeStyle: 'local', maxResults: 10, major: 5, eventAttribute: 'attendance' },
      { name: 'json-m5-utcZ', timeStyle: 'utcZ', maxResults: 30, major: 5 },
      { name: 'json-m5-utcNoZ', timeStyle: 'utcNoZ', maxResults: 30, major: 5 },
      { name: 'json-m5-offset-max10', timeStyle: 'offset', maxResults: 10, major: 5 },
    ];

    for (const p of prioritized) {
      const startTime = formatHikvisionTime(start, p.timeStyle);
      const endTime = formatHikvisionTime(end, p.timeStyle);
      const cond: Record<string, unknown> = {
        searchID: p.searchIdOverride ?? searchId,
        searchResultPosition: position,
        maxResults: p.maxResults,
        major: p.major,
        startTime,
        endTime,
      };
      if (p.includeMinor0) cond.minor = 0;
      if (p.minor !== undefined) cond.minor = p.minor;
      if (p.eventAttribute) cond.eventAttribute = p.eventAttribute;
      attempts.push({
        name: p.name,
        path: '/ISAPI/AccessControl/AcsEvent?format=json',
        contentType: 'application/json',
        body: JSON.stringify({ AcsEventCond: cond }),
        timeStyle: p.timeStyle,
        maxResults: p.maxResults,
        major: p.major,
        includeMinor0: Boolean(p.includeMinor0),
        eventAttribute: p.eventAttribute,
      });
    }

    for (const timeStyle of ['local', 'offset'] as TimeFormatName[]) {
      const startTime = formatHikvisionTime(start, timeStyle);
      const endTime = formatHikvisionTime(end, timeStyle);
      attempts.push({
        name: `xml-${timeStyle}`,
        path: '/ISAPI/AccessControl/AcsEvent',
        contentType: 'application/xml',
        body: `<?xml version="1.0" encoding="UTF-8"?>
<AcsEventCond version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <searchID>${searchId}</searchID>
  <searchResultPosition>${position}</searchResultPosition>
  <maxResults>30</maxResults>
  <major>5</major>
  <startTime>${startTime}</startTime>
  <endTime>${endTime}</endTime>
</AcsEventCond>`,
        timeStyle,
        maxResults: 30,
        major: 5,
        includeMinor0: false,
      });
    }

    return attempts;
  }

  private async probeAcsEventAttempts(
    start: Date,
    end: Date,
    position: number,
  ): Promise<Array<{ name: string; status: number; error?: string; bodyPreview?: string }>> {
    const results: Array<{ name: string; status: number; error?: string; bodyPreview?: string }> =
      [];
    // Cap probe volume so diagnostics stay fast
    const attempts = this.buildAcsAttempts(start, end, position).slice(0, 12);
    for (const attempt of attempts) {
      try {
        const res = await isapiRequest(
          this.config,
          'POST',
          attempt.path,
          attempt.body,
          attempt.contentType,
        );
        results.push({
          name: attempt.name,
          status: res.status,
          error: res.status === 200 ? undefined : extractIsapiError(res.body),
          bodyPreview: res.body.slice(0, 240),
        });
        if (res.status === 200) break;
      } catch (err) {
        results.push({
          name: attempt.name,
          status: 0,
          error: err instanceof Error ? err.message : 'request failed',
        });
        // Device offline — stop probing variants
        if (isDeviceUnreachableError(err)) break;
      }
    }
    return results;
  }

  private async fetchAcsEventPage(
    start: Date,
    end: Date,
    position: number,
  ): Promise<{ events: DeviceAttendanceEvent[]; totalMatches?: number; responseStatus?: string }> {
    const attempts = this.buildAcsAttempts(start, end, position);

    // Prefer the strategy that already worked for this session — try only that first.
    const ordered = this.acsEventStrategy
      ? [
          ...attempts.filter((a) => a.name === this.acsEventStrategy!.name),
          // Fall back only if the known shape fails (firmware change / stale cache)
          ...attempts.filter((a) => a.name !== this.acsEventStrategy!.name),
        ]
      : attempts;

    let lastStatus = 0;
    let lastBody = '';
    let lastName = '';
    const preferredName = this.acsEventStrategy?.name;

    for (const attempt of ordered) {
      try {
        const res = await isapiRequest(
          this.config,
          'POST',
          attempt.path,
          attempt.body,
          attempt.contentType,
        );
        lastStatus = res.status;
        lastBody = res.body;
        lastName = attempt.name;

        if (res.status === 401) {
          throw Object.assign(new Error('Authentication failed while fetching events'), {
            code: 'AUTH_FAILED',
          });
        }

        if (res.status === 200) {
          this.acsEventStrategy = {
            name: attempt.name,
            path: attempt.path,
            contentType: attempt.contentType,
            timeStyle: attempt.timeStyle,
            maxResults: attempt.maxResults,
            major: attempt.major,
            includeMinor0: attempt.includeMinor0,
            eventAttribute: attempt.eventAttribute,
          };
          logDeviceAction({
            ip: this.config.ipAddress,
            action: 'AcsEvent',
            result: 'ok',
            status: 200,
            message: `variant=${attempt.name} pos=${position}`,
          });
          return this.parseAcsEventResponse(res.body);
        }

        logDeviceAction({
          ip: this.config.ipAddress,
          action: 'AcsEvent',
          result: 'error',
          status: res.status,
          message: `variant=${attempt.name} ${extractIsapiError(res.body) ?? ''}`.trim(),
        });

        // Known-good strategy failed — clear it and continue probing once.
        if (preferredName && attempt.name === preferredName) {
          this.acsEventStrategy = undefined;
        } else if (preferredName && attempt.name !== preferredName) {
          // After a failed preferred attempt we already cleared; keep probing.
        } else if (!preferredName && lastStatus >= 500) {
          // Device error — don't burn through every variant on 5xx
          break;
        }
      } catch (err) {
        if ((err as { code?: string }).code === 'AUTH_FAILED') throw err;

        // Device offline / timeout — stop immediately (do not walk every variant).
        if (isDeviceUnreachableError(err)) {
          this.acsEventStrategy = undefined;
          logDeviceAction({
            ip: this.config.ipAddress,
            action: 'AcsEvent',
            result: 'error',
            message: `device unreachable — stopped after variant=${attempt.name}`,
          });
          throw deviceUnreachableError(
            err instanceof Error
              ? err.message
              : 'Device is not reachable on the network',
            err,
          );
        }

        logDeviceAction({
          ip: this.config.ipAddress,
          action: 'AcsEvent',
          result: 'error',
          message: `variant=${attempt.name} ${err instanceof Error ? err.message : 'request failed'}`,
        });
        if (preferredName && attempt.name === preferredName) {
          this.acsEventStrategy = undefined;
        }
      }
    }

    const detail = extractIsapiError(lastBody);
    throw new Error(
      detail
        ? `Failed to fetch attendance events (HTTP ${lastStatus}, ${lastName}): ${detail}`
        : `Failed to fetch attendance events (HTTP ${lastStatus || 'error'})`,
    );
  }

  private parseAcsEventResponse(body: string): {
    events: DeviceAttendanceEvent[];
    totalMatches?: number;
    responseStatus?: string;
  } {
    try {
      const parsed = JSON.parse(body) as {
        AcsEvent?: {
          responseStatusStrg?: string;
          totalMatches?: number;
          numOfMatches?: number;
          InfoList?: AcsInfo[] | AcsInfo;
        };
        // Some firmwares nest differently
        AcsEventCond?: unknown;
      };

      const acs = parsed.AcsEvent;
      let list: AcsInfo[] = [];
      if (Array.isArray(acs?.InfoList)) list = acs.InfoList;
      else if (acs?.InfoList && typeof acs.InfoList === 'object') list = [acs.InfoList as AcsInfo];

      return {
        events: list.map((item) => this.mapAcsInfo(item)),
        totalMatches: acs?.totalMatches,
        responseStatus: acs?.responseStatusStrg,
      };
    } catch {
      return { events: this.parseXmlEvents(body) };
    }
  }

  private mapAcsInfo(item: AcsInfo): DeviceAttendanceEvent {
    const employeeId = String(
      item.employeeNoString ?? item.employeeNo ?? item.cardNo ?? 'unknown',
    );
    const rawName = item.name ?? item.personName;
    const employeeName =
      rawName !== undefined && rawName !== null && String(rawName).trim()
        ? String(rawName).trim()
        : employeeId;
    const timeRaw = item.time ? String(item.time) : undefined;
    const eventTime = parseDeviceTime(timeRaw) ?? new Date();
    const attendanceStatus = item.attendanceStatus ?? item.attendanceStatusValue;
    const major = item.major ?? item.majorEventType;
    const minor = item.minor ?? item.subEventType ?? item.minorEventType;

    return {
      externalId: buildExternalId(this.deviceSerial, item),
      employeeId,
      employeeName,
      checkType: mapAttendanceStatus(attendanceStatus as string | number | undefined),
      eventTime,
      authMethod: mapAuthMethod(item),
      cardNumber: item.cardNo !== undefined ? String(item.cardNo) : undefined,
      eventType: major !== undefined || minor !== undefined ? `${major ?? ''}/${minor ?? ''}` : undefined,
      majorEventType: typeof major === 'number' ? major : major !== undefined ? Number(major) : undefined,
      minorEventType: typeof minor === 'number' ? minor : minor !== undefined ? Number(minor) : undefined,
      serialNumber: item.serialNo !== undefined ? String(item.serialNo) : undefined,
      rawEventCode: minor !== undefined ? String(minor) : undefined,
      source: 'hikvision-device',
      rawData: item,
    };
  }

  private parseXmlEvents(xml: string): DeviceAttendanceEvent[] {
    const events: DeviceAttendanceEvent[] = [];
    const blocks = xml.match(/<Info>[\s\S]*?<\/Info>/gi) ?? [];
    for (const block of blocks) {
      const employeeId = xmlTag(block, 'employeeNoString') ?? xmlTag(block, 'employeeNo') ?? 'unknown';
      const time = xmlTag(block, 'time');
      const serialNo = xmlTag(block, 'serialNo');
      const item: AcsInfo = {
        employeeNoString: employeeId,
        name: xmlTag(block, 'name'),
        time,
        serialNo,
        attendanceStatus: xmlTag(block, 'attendanceStatus'),
        cardNo: xmlTag(block, 'cardNo'),
        major: xmlTag(block, 'major'),
        minor: xmlTag(block, 'minor'),
      };
      events.push(this.mapAcsInfo(item));
    }
    return events;
  }
}
