import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';
import { testDeviceConnection, fetchAcsEvents } from './isapi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Simple zero-dependency .env loader. */
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

loadEnv();

const config = {
  ipAddress: process.env.HIKVISION_IP || '192.168.0.6',
  port: Number(process.env.HIKVISION_PORT || 80),
  username: process.env.HIKVISION_USERNAME || 'admin',
  password: process.env.HIKVISION_PASSWORD || '',
  apiUrl: (process.env.INSFORGE_API_URL || process.env.SERVER_URL || 'https://ew5ub4j6.ap-southeast.insforge.app/api').replace(/\/$/, ''),
  gatewaySecret: process.env.GATEWAY_SECRET || 'default_gateway_secret',
  syncIntervalMs: Number(process.env.SYNC_INTERVAL_SECONDS || 30) * 1000,
  heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_SECONDS || 10) * 1000,
};

console.log('====================================================');
console.log(' Hikvision Local Gateway & Attendance Sync Agent');
console.log('====================================================');
console.log(`[Config] Target Device: http://${config.ipAddress}:${config.port} (user: ${config.username})`);
console.log(`[Config] Cloud API URL: ${config.apiUrl}`);
console.log(`[Config] Sync Interval: ${config.syncIntervalMs / 1000}s`);
console.log(`[Config] Heartbeat Interval: ${config.heartbeatIntervalMs / 1000}s`);
console.log('====================================================\n');

let lastSuccessTime = null;
let lastSyncTime = null;
let cachedDeviceInfo = null;
let isSyncing = false;

function postJson(endpointPath, bodyData) {
  return new Promise((resolve, reject) => {
    const fullUrl = `${config.apiUrl}${endpointPath}`;
    const urlObj = new URL(fullUrl);
    const transport = urlObj.protocol === 'https:' ? https : http;
    const bodyStr = JSON.stringify(bodyData);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Authorization': `Bearer ${config.gatewaySecret}`,
        'X-Gateway-Secret': config.gatewaySecret,
      },
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(bodyStr);
    req.end();
  });
}

async function sendHeartbeat() {
  try {
    const testRes = await testDeviceConnection(config);
    if (testRes.online) {
      lastSuccessTime = new Date().toISOString();
      if (testRes.deviceInfo) cachedDeviceInfo = testRes.deviceInfo;
    }

    const payload = {
      gatewayStatus: 'online',
      deviceStatus: testRes.online ? 'online' : (testRes.authState || 'offline'),
      deviceInfo: testRes.deviceInfo || cachedDeviceInfo || null,
      lastConnectionSuccess: lastSuccessTime,
      lastSyncTime,
      errorMessage: testRes.online ? null : testRes.message,
      gatewayIp: config.ipAddress,
      version: '1.0.0',
    };

    const res = await postJson('/gateway/heartbeat', payload);
    const timeStr = new Date().toLocaleTimeString();

    if (res.status === 200 && res.data?.success) {
      if (testRes.online) {
        console.log(`[${timeStr}] Heartbeat: Device ONLINE (${testRes.latencyMs}ms) · Cloud API ACK`);
      } else {
        console.warn(`[${timeStr}] Heartbeat: Device WARNING (${testRes.message}) · Cloud API ACK`);
      }

      // Process pending command if issued by cloud server
      if (res.data?.pendingCommand) {
        await executePendingCommand(res.data.pendingCommand);
      }
    } else {
      console.error(`[${timeStr}] Heartbeat failed (HTTP ${res.status}): ${res.data?.message || 'API error'}`);
    }
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] Heartbeat error: ${err.message}`);
  }
}

async function executePendingCommand(cmd) {
  console.log(`[Command] Executing pending command: ${cmd.type} (id: ${cmd.id})`);
  let result;
  if (cmd.type === 'test') {
    const testRes = await testDeviceConnection(config);
    result = {
      commandId: cmd.id,
      success: testRes.online,
      result: testRes,
    };
  } else if (cmd.type === 'sync') {
    const syncRes = await runSync();
    result = {
      commandId: cmd.id,
      success: true,
      result: syncRes,
    };
  }

  if (result) {
    await postJson('/gateway/command-result', result).catch((e) => {
      console.error(`[Command] Failed to return command result: ${e.message}`);
    });
  }
}

async function runSync() {
  if (isSyncing) return null;
  isSyncing = true;
  try {
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000); // last 24 hours
    const events = await fetchAcsEvents(config, start, now, cachedDeviceInfo?.serialNumber || 'DS-K1T320EFWX');

    if (events.length > 0) {
      console.log(`[Sync] Downloaded ${events.length} attendance events from device. Uploading to cloud...`);
      const uploadRes = await postJson('/gateway/logs', { events });
      if (uploadRes.status === 200 && uploadRes.data?.success) {
        lastSyncTime = new Date().toISOString();
        const d = uploadRes.data.data;
        console.log(`[Sync] Upload Success: Inserted ${d?.inserted || 0}, Duplicates ${d?.duplicates || 0}, Failed ${d?.failed || 0}`);
        return d;
      } else {
        console.error(`[Sync] Upload Failed (HTTP ${uploadRes.status}): ${uploadRes.data?.message || 'Server error'}`);
      }
    } else {
      console.log(`[Sync] No new events found on device (${now.toLocaleTimeString()}).`);
      lastSyncTime = new Date().toISOString();
    }
  } catch (err) {
    console.error(`[Sync] Sync error: ${err.message}`);
  } finally {
    isSyncing = false;
  }
  return null;
}

// Initial startup execution
sendHeartbeat();
runSync();

// Periodic intervals
setInterval(sendHeartbeat, config.heartbeatIntervalMs);
setInterval(runSync, config.syncIntervalMs);
