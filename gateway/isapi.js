import http from 'http';
import https from 'https';
import net from 'net';
import crypto from 'crypto';

const REQUEST_TIMEOUT_MS = 12000;
const REACHABILITY_TIMEOUT_MS = 1500;

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 4, keepAliveMsecs: 30000 });
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 4,
  keepAliveMsecs: 30000,
  rejectUnauthorized: false,
});

/** Fast TCP reachability check before sending HTTP requests. */
export function probeTcpPort(host, port, timeoutMs = REACHABILITY_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok) => {
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

function parseDigestHeader(header) {
  const params = {};
  const regex = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
  let match;
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[2] ?? match[3] ?? '';
  }
  return params;
}

function pickWwwAuthenticate(headers) {
  const raw = headers['www-authenticate'];
  if (!raw) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  return values.find((v) => /digest/i.test(v)) ?? values.find((v) => /basic/i.test(v)) ?? values[0];
}

function buildDigestAuth(method, uri, username, password, params, opts = {}) {
  const encoding = opts.encoding ?? 'utf8';
  const algorithmMode = opts.algorithmMode ?? 'omit';
  const realm = params.realm ?? '';
  const nonce = params.nonce ?? '';
  const qopRaw = (params.qop ?? '').trim();
  const qop = qopRaw
    ? (qopRaw.split(',').map((q) => q.trim()).find((q) => /^auth$/i.test(q)) ?? qopRaw.split(',')[0].trim())
    : '';
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const md5 = (s) => crypto.createHash('md5').update(s, encoding).digest('hex');

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

function buildBasicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

function rawIsapiRequest(config, method, apiPath, authHeader, body, contentType = 'application/xml') {
  const useHttps = Number(config.port) === 443 || config.useHttps === true;
  const transport = useHttps ? https : http;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: config.ipAddress,
      port: Number(config.port),
      path: apiPath,
      method,
      timeout: REQUEST_TIMEOUT_MS,
      agent: useHttps ? httpsAgent : httpAgent,
      headers: {
        Accept: 'application/json, application/xml, */*',
        Connection: 'keep-alive',
        ...(body ? { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      ...(useHttps ? { rejectUnauthorized: false } : {}),
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body: data, headers: res.headers });
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      const err = new Error(`Request timeout — device did not respond (${config.ipAddress}:${config.port})`);
      err.code = 'ETIMEDOUT';
      reject(err);
    });

    if (body) req.write(body);
    req.end();
  });
}

/** Execute ISAPI request handling 401 Digest challenges. */
export async function isapiRequest(config, method, apiPath, body, contentType = 'application/xml') {
  const start = Date.now();
  const unauth = await rawIsapiRequest(config, method, apiPath, undefined, body, contentType);

  if (unauth.status !== 401) {
    return { status: unauth.status, body: unauth.body, latencyMs: Date.now() - start, headers: unauth.headers };
  }

  const wwwAuth = pickWwwAuthenticate(unauth.headers);
  if (!wwwAuth) {
    return { status: 401, body: unauth.body, latencyMs: Date.now() - start, headers: unauth.headers };
  }

  if (/basic/i.test(wwwAuth) && !/digest/i.test(wwwAuth)) {
    const basicAuth = buildBasicAuth(config.username, config.password);
    const res = await rawIsapiRequest(config, method, apiPath, basicAuth, body, contentType);
    return { status: res.status, body: res.body, latencyMs: Date.now() - start, headers: res.headers };
  }

  const digestParams = parseDigestHeader(wwwAuth);
  const variants = [
    { encoding: 'utf8', algorithmMode: 'omit' },
    { encoding: 'utf8', algorithmMode: 'quoted' },
    { encoding: 'utf8', algorithmMode: 'raw' },
    { encoding: 'latin1', algorithmMode: 'omit' },
  ];

  for (const v of variants) {
    const authHeader = buildDigestAuth(method, apiPath, config.username, config.password, digestParams, v);
    const res = await rawIsapiRequest(config, method, apiPath, authHeader, body, contentType);
    if (res.status !== 401) {
      return { status: res.status, body: res.body, latencyMs: Date.now() - start, headers: res.headers };
    }
  }

  return { status: 401, body: 'Authentication failed', latencyMs: Date.now() - start, headers: unauth.headers };
}

function xmlTag(xml, tag) {
  const reg = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const m = reg.exec(xml);
  return m ? m[1].trim() : null;
}

export function extractIsapiError(body) {
  if (!body) return null;
  const statusString = xmlTag(body, 'statusString');
  const subStatusCode = xmlTag(body, 'subStatusCode');
  const statusMsg = xmlTag(body, 'errorMsg') ?? xmlTag(body, 'message');
  if (statusString || subStatusCode || statusMsg) {
    return [statusString, subStatusCode, statusMsg].filter(Boolean).join(' - ');
  }
  return null;
}

/** Test device connection and fetch system deviceInfo. */
export async function testDeviceConnection(config) {
  const reachable = await probeTcpPort(config.ipAddress, Number(config.port), REACHABILITY_TIMEOUT_MS);
  if (!reachable) {
    return {
      online: false,
      authState: 'device_unreachable',
      latencyMs: 0,
      message: `Device unreachable at ${config.ipAddress}:${config.port}`,
    };
  }

  try {
    const res = await isapiRequest(config, 'GET', '/ISAPI/System/deviceInfo');
    if (res.status === 401) {
      return {
        online: false,
        authState: 'authentication_failed',
        latencyMs: res.latencyMs,
        message: 'Authentication failed — invalid Hikvision username or password',
      };
    }
    if (res.status === 404) {
      return {
        online: false,
        authState: 'isapi_unsupported',
        latencyMs: res.latencyMs,
        message: 'ISAPI endpoint unsupported on this device',
      };
    }
    if (res.status !== 200) {
      return {
        online: false,
        authState: 'reachable',
        latencyMs: res.latencyMs,
        message: `Device responded with HTTP ${res.status}: ${extractIsapiError(res.body) || 'deviceInfo failed'}`,
      };
    }

    const model = xmlTag(res.body, 'model') ?? 'DS-K1T320EFWX';
    const serialNumber = xmlTag(res.body, 'serialNumber');
    const firmwareVersion = xmlTag(res.body, 'firmwareVersion');
    const macAddress = xmlTag(res.body, 'macAddress');
    let deviceTime = xmlTag(res.body, 'deviceTime') ?? xmlTag(res.body, 'localTime');

    try {
      const timeRes = await isapiRequest(config, 'GET', '/ISAPI/System/time');
      if (timeRes.status === 200) {
        deviceTime = xmlTag(timeRes.body, 'localTime') ?? xmlTag(timeRes.body, 'time') ?? deviceTime;
      }
    } catch {
      // optional
    }

    return {
      online: true,
      authState: 'authenticated',
      latencyMs: res.latencyMs,
      message: 'Authenticated with Hikvision device successfully',
      deviceInfo: {
        model,
        serialNumber,
        firmwareVersion,
        deviceTime,
        macAddress,
      },
    };
  } catch (err) {
    return {
      online: false,
      authState: 'device_unreachable',
      latencyMs: 0,
      message: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}

/** Fetch AcsEvents from Hikvision ISAPI. */
export async function fetchAcsEvents(config, start, end, serialNumber = 'hik') {
  const formatTime = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+05:45`;
  };

  const startTimeStr = formatTime(start);
  const endTimeStr = formatTime(end);

  const attempts = [
    { major: 5, timeStyle: startTimeStr },
    { major: 0, timeStyle: startTimeStr, minor: 0 },
    { major: 5, timeStyle: startTimeStr, minor: 75 },
  ];

  let rawEvents = [];
  let success = false;

  for (const att of attempts) {
    const cond = {
      searchID: '1',
      searchResultPosition: 0,
      maxResults: 50,
      major: att.major,
      startTime: startTimeStr,
      endTime: endTimeStr,
    };
    if (att.minor !== undefined) cond.minor = att.minor;

    try {
      const res = await isapiRequest(
        config,
        'POST',
        '/ISAPI/AccessControl/AcsEvent?format=json',
        JSON.stringify({ AcsEventCond: cond }),
        'application/json'
      );

      if (res.status === 200) {
        const json = JSON.parse(res.body);
        const match = json?.AcsEvent?.InfoList ?? json?.AcsEventSearch?.InfoList ?? [];
        if (Array.isArray(match)) {
          rawEvents = match;
          success = true;
          break;
        }
      }
    } catch {
      // try next attempt
    }
  }

  const events = [];
  for (const item of rawEvents) {
    const empId = String(item.employeeNo ?? item.employeeID ?? item.cardNo ?? '').trim();
    if (!empId || empId === '0' || empId.toLowerCase() === 'unknown') continue;

    const name = String(item.name ?? item.employeeName ?? empId).trim();
    const eventTimeStr = item.time ?? item.eventTime ?? new Date().toISOString();
    const eventTime = new Date(eventTimeStr);
    if (Number.isNaN(eventTime.getTime())) continue;

    let checkType = 'punch';
    const statusVal = String(item.attendanceStatus ?? item.attendanceStatusValue ?? '').toLowerCase();
    if (statusVal.includes('checkin') || statusVal === '0') checkType = 'check_in';
    else if (statusVal.includes('checkout') || statusVal === '1') checkType = 'check_out';

    const minor = item.minor ?? item.minorEventType ?? 0;
    const eventIso = eventTime.toISOString();
    const externalId = `hik_${serialNumber}_${empId}_${eventIso}_${minor}`;

    events.push({
      externalId,
      employeeId: empId,
      employeeName: name || empId,
      checkType,
      eventTime: eventIso,
      authMethod: String(item.currentVerifyMode ?? item.authMethod ?? 'Face/Card'),
      cardNumber: item.cardNo ? String(item.cardNo) : null,
      rawEventCode: String(item.major ?? '5') + '_' + String(minor),
      serialNumber,
      source: 'hikvision-device',
      rawData: item,
    });
  }

  return events;
}
