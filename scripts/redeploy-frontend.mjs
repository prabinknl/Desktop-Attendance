/**
 * Redeploy the InsForge frontend with VITE_API_BASE_URL set for the Vite build.
 * Avoids PowerShell mangling of --env JSON.
 */
import { spawnSync } from 'node:child_process';

const API =
  process.env.VITE_API_BASE_URL ??
  'https://attendance-api-b8a4b02c-6a27-402f-8cc4-ba21910570f4.fly.dev/api';

const envJson = JSON.stringify({ VITE_API_BASE_URL: API });
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

console.log(`Setting deployments env VITE_API_BASE_URL=${API}`);
let result = spawnSync(
  npx,
  ['--yes', '@insforge/cli@latest', 'deployments', 'env', 'set', 'VITE_API_BASE_URL', API],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

console.log('Deploying frontend with --env …');
result = spawnSync(
  npx,
  ['--yes', '@insforge/cli@latest', 'deployments', 'deploy', '.', '--env', envJson, '--json'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
