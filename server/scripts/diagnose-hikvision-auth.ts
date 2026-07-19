/**
 * Diagnose Hikvision ISAPI auth against a device (password via env only).
 * Usage (from repo root):
 *   set DEVICE_IP=192.168.0.2
 *   set DEVICE_USER=admin
 *   set DEVICE_PASS=yourpassword
 *   npx tsx server/scripts/diagnose-hikvision-auth.ts
 */
import http from 'http';
import https from 'https';
import crypto from 'crypto';

const ip = process.env.DEVICE_IP || '192.168.0.2';
const port = Number(process.env.DEVICE_PORT || 80);
const username = (process.env.DEVICE_USER || 'admin').trim();
const password = process.env.DEVICE_PASS || '';
const useHttps = port === 443 || process.env.DEVICE_HTTPS === '1';
const path = process.env.DEVICE_PATH || '/ISAPI/System/deviceInfo';

if (!password) {
  console.error('Set DEVICE_PASS to the device web-login password, then re-run.');
  process.exit(1);
}

function parseDigest(header: string): Record<string, string> {
  const params: Record<string, string> = {};
  const regex = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(header)) !== null) params[m[1]] = m[2] ?? m[3] ?? '';
  return params;
}

function md5(s: string) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

function buildDigest(method: string, uri: string, params: Record<string, string>, algMode: 'omit' | 'as-is' | 'quoted') {
  const realm = params.realm ?? '';
  const nonce = params.nonce ?? '';
  const qopRaw = (params.qop ?? '').trim();
  const qop = qopRaw
    ? (qopRaw.split(',').map((q) => q.trim()).find((q) => q === 'auth') ?? qopRaw.split(',')[0].trim())
    : '';
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  let ha1 = md5(`${username}:${realm}:${password}`);
  if (/md5-sess/i.test(params.algorithm ?? '')) ha1 = md5(`${ha1}:${nonce}:${cnonce}`);
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
  if (algMode === 'as-is' && params.algorithm) parts.push(`algorithm=${params.algorithm}`);
  if (algMode === 'quoted' && params.algorithm) parts.push(`algorithm="${params.algorithm}"`);
  if (qop) {
    parts.push(`qop=${qop}`);
    parts.push(`nc=${nc}`);
    parts.push(`cnonce="${cnonce}"`);
  }
  if (params.opaque) parts.push(`opaque="${params.opaque}"`);
  return `Digest ${parts.join(', ')}`;
}

function request(auth?: string): Promise<{ status: number; www?: string; body: string }> {
  const transport = useHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: ip,
        port,
        path,
        method: 'GET',
        timeout: 8000,
        rejectUnauthorized: false,
        headers: {
          Accept: '*/*',
          Connection: 'close',
          ...(auth ? { Authorization: auth } : {}),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          const raw = res.headers['www-authenticate'];
          const www = Array.isArray(raw) ? raw.join(' | ') : raw;
          resolve({ status: res.statusCode ?? 0, www, body: body.slice(0, 200) });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.end();
  });
}

async function main() {
  console.log(`Probing ${useHttps ? 'https' : 'http'}://${ip}:${port}${path}`);
  console.log(`User: ${username}  Password length: ${password.length}`);

  const challenge = await request();
  console.log(`Unauth status: ${challenge.status}`);
  console.log(`WWW-Authenticate: ${challenge.www ?? '(none)'}`);

  if (challenge.status !== 401 || !challenge.www) {
    console.log('Unexpected challenge — device may be unreachable or not Hikvision ISAPI.');
    return;
  }

  const digestHeader = challenge.www.split('|').map((s) => s.trim()).find((s) => /digest/i.test(s)) ?? challenge.www;
  const params = parseDigest(digestHeader);
  console.log('Digest params:', {
    realm: params.realm,
    qop: params.qop,
    algorithm: params.algorithm,
    stale: params.stale,
    hasOpaque: Boolean(params.opaque),
  });

  const attempts: Array<{ name: string; auth: string }> = [
    { name: 'digest omit-algorithm', auth: buildDigest('GET', path, params, 'omit') },
    { name: 'digest algorithm as-is', auth: buildDigest('GET', path, params, 'as-is') },
    { name: 'digest algorithm quoted', auth: buildDigest('GET', path, params, 'quoted') },
    { name: 'basic', auth: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}` },
  ];

  // Also try absolute URI form some firmwares want
  const absUri = `${useHttps ? 'https' : 'http'}://${ip}:${port}${path}`;
  attempts.push({ name: 'digest absolute-uri', auth: buildDigest('GET', absUri, params, 'omit') });

  for (const a of attempts) {
    // Fresh challenge each time (nonce may be one-time)
    const ch = await request();
    const hdr = (ch.www ?? '').split('|').map((s) => s.trim()).find((s) => /digest/i.test(s)) ?? ch.www ?? '';
    const p = parseDigest(hdr);
    let auth = a.auth;
    if (a.name.startsWith('digest')) {
      const mode = a.name.includes('quoted')
        ? 'quoted'
        : a.name.includes('as-is')
          ? 'as-is'
          : 'omit';
      const uri = a.name.includes('absolute') ? absUri : path;
      auth = buildDigest('GET', uri, p, mode);
    }
    const res = await request(auth);
    console.log(`${a.name.padEnd(28)} -> HTTP ${res.status}${res.status === 200 ? ' OK' : ''}`);
    if (res.status === 200) {
      console.log('SUCCESS body snippet:', res.body.replace(/\s+/g, ' ').slice(0, 120));
      return;
    }
  }

  console.log('All attempts failed — password is wrong for this device, or ISAPI auth is disabled.');
}

main().catch((e) => {
  console.error('Probe failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
