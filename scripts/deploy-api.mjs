/**
 * Deploys the Express API in server/ to InsForge compute.
 *
 * Reads server/.env, applies the production overrides, and hands the result to
 * the CLI through a temporary env file that is deleted afterwards. Secrets are
 * never printed and never baked into the image (server/.dockerignore excludes
 * .env), they are stored encrypted on the compute service.
 *
 * Usage: npm run deploy:api
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SERVICE_NAME = 'attendance-api';
const PORT = '8080';
const REGION = 'sin';
const MEMORY = '512';

const OVERRIDES = {
  NODE_ENV: 'production',
  PORT,
  // The attendance machine is LAN-only and unreachable from the cloud.
  DEVICE_SYNC_ENABLED: 'false',
  CORS_ORIGINS: 'https://ew5ub4j6.insforge.site',
};

const repoRoot = path.resolve(import.meta.dirname, '..');
const envPath = path.join(repoRoot, 'server', '.env');

if (!fs.existsSync(envPath)) {
  console.error('server/.env not found — it supplies DATABASE_URL and the SMTP settings.');
  process.exit(1);
}

const keep = fs
  .readFileSync(envPath, 'utf8')
  .split(/\r?\n/)
  .filter((line) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line))
  .filter((line) => !(line.split('=')[0].trim() in OVERRIDES));

const merged = [...keep, ...Object.entries(OVERRIDES).map(([k, v]) => `${k}=${v}`)];
const tmpFile = path.join(os.tmpdir(), `insforge-api-deploy-${process.pid}.env`);
fs.writeFileSync(tmpFile, `${merged.join('\n')}\n`, 'utf8');

console.log(`Deploying "${SERVICE_NAME}" with ${merged.length} environment variables...`);

try {
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      '--yes', '@insforge/cli@latest', 'compute', 'deploy', 'server',
      '--name', SERVICE_NAME,
      '--port', PORT,
      '--region', REGION,
      '--memory', MEMORY,
      '--env-file', tmpFile,
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  process.exitCode = result.status ?? 1;
  if ((result.status ?? 1) === 0) {
    console.log(`
Next: point the hosted frontend at this API, then redeploy the site.

  1. Copy the Endpoint URL printed above (e.g. https://attendance-api-….fly.dev)
  2. Set GitHub Actions variable VITE_API_BASE_URL to <Endpoint>/api
  3. Persist for InsForge builds:
       npx @insforge/cli deployments env set VITE_API_BASE_URL <Endpoint>/api
  4. Redeploy frontend (push to main, or: npx @insforge/cli deployments deploy .)
`);
  }
} finally {
  fs.rmSync(tmpFile, { force: true });
}
