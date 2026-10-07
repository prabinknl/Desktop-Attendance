/**
 * Verifies a built Windows release before it is published.
 *
 *   node scripts/verify-release.cjs [releaseDir]
 *
 * Checks:
 *  - latest.yml version/path match package.json and the versioned installer,
 *    and its sha512 + size match the file (what electron-updater validates).
 *  - The .blockmap exists (differential updates).
 *  - Attendance-Desktop-Setup.exe is byte-identical to the versioned installer.
 *  - win-unpacked/resources/app-update.yml points at the GitHub repo in package.json.
 *  - No .env files, tokens or private keys are packaged, and no secret value
 *    from the developer's local env files appears in the packaged app.
 *    Only key names are ever printed, never values.
 *  - Reports (does not fail on) the Authenticode signature status.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const releaseDir = path.resolve(process.argv[2] || path.join(root, 'release'));
const version = pkg.version;
const versionedName = `Attendance.Desktop.Setup.${version}.exe`;
const stableName = 'Attendance-Desktop-Setup.exe';
const publish = (pkg.build?.publish ?? []).find((p) => p.provider === 'github') ?? {};

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);
const ok = (msg) => console.log(`  OK   ${msg}`);

function sha512Base64(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

function yamlScalar(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*['"]?([^'"\\r\\n]+)['"]?\\s*$`, 'm'));
  return m ? m[1].trim() : undefined;
}

console.log(`[verify-release] ${releaseDir} (version ${version})`);

// 1. Installer, latest.yml, blockmap, stable copy
const installer = path.join(releaseDir, versionedName);
const latestYml = path.join(releaseDir, 'latest.yml');
const blockmap = `${installer}.blockmap`;
const stable = path.join(releaseDir, stableName);

if (!fs.existsSync(installer)) fail(`Missing ${versionedName}`);
if (!fs.existsSync(latestYml)) fail('Missing latest.yml');
if (!fs.existsSync(blockmap) || fs.statSync(blockmap).size === 0) fail(`Missing or empty ${path.basename(blockmap)}`);
else ok(path.basename(blockmap));

if (fs.existsSync(installer) && fs.existsSync(latestYml)) {
  const yml = fs.readFileSync(latestYml, 'utf8');
  const actualSha = sha512Base64(installer);
  const actualSize = fs.statSync(installer).size;

  const ymlVersion = yamlScalar(yml, 'version');
  const ymlPath = yamlScalar(yml, 'path');
  const ymlSha = yamlScalar(yml, 'sha512');
  const fileUrl = yml.match(/-\s+url:\s*['"]?([^'"\r\n]+)/)?.[1]?.trim();
  const fileSha = yml.match(/^\s+sha512:\s*['"]?([^'"\r\n]+)/m)?.[1]?.trim();
  const fileSize = Number(yml.match(/^\s+size:\s*(\d+)/m)?.[1]);

  if (ymlVersion !== version) fail(`latest.yml version ${ymlVersion} != package.json ${version}`);
  else ok(`latest.yml version ${ymlVersion}`);
  if (ymlPath !== versionedName || fileUrl !== versionedName) {
    fail(`latest.yml path/url (${ymlPath} / ${fileUrl}) != ${versionedName}`);
  } else ok(`latest.yml references ${versionedName}`);
  if (ymlSha !== actualSha || fileSha !== actualSha) fail('latest.yml sha512 does not match the installer');
  else ok('latest.yml sha512 matches installer');
  if (fileSize !== actualSize) fail(`latest.yml size ${fileSize} != installer size ${actualSize}`);
  else ok(`latest.yml size ${actualSize}`);

  if (!fs.existsSync(stable)) fail(`Missing ${stableName}`);
  else if (fs.statSync(stable).size !== actualSize || sha512Base64(stable) !== actualSha) {
    fail(`${stableName} differs from ${versionedName}`);
  } else ok(`${stableName} identical to ${versionedName}`);
}

// 2. Updater config inside the packaged app
const resourcesDir = path.join(releaseDir, 'win-unpacked', 'resources');
const appUpdateYml = path.join(resourcesDir, 'app-update.yml');
if (!fs.existsSync(appUpdateYml)) {
  fail('win-unpacked/resources/app-update.yml missing (auto-update would not work)');
} else {
  const text = fs.readFileSync(appUpdateYml, 'utf8');
  const provider = yamlScalar(text, 'provider');
  const owner = yamlScalar(text, 'owner');
  const repo = yamlScalar(text, 'repo');
  if (provider !== 'github' || owner !== publish.owner || repo !== publish.repo) {
    fail(`app-update.yml points at ${provider}:${owner}/${repo}, expected github:${publish.owner}/${publish.repo}`);
  } else ok(`app-update.yml -> github ${owner}/${repo}`);
  if (/token\s*:/i.test(text)) fail('app-update.yml contains a token');
}

// 2b. Every local require() in the packaged Electron main files must exist in app.asar
const asarPath = path.join(resourcesDir, 'app.asar');
if (fs.existsSync(asarPath)) {
  try {
    const asar = require('@electron/asar');
    const entries = new Set(asar.listPackage(asarPath).map((p) => p.replace(/\\/g, '/').replace(/^\//, '')));
    const missing = [];
    for (const entry of entries) {
      if (!/^electron\/[^/]+\.c?js$/.test(entry)) continue;
      const source = asar.extractFile(asarPath, entry).toString('utf8');
      for (const m of source.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(entry), m[1]));
        const candidates = [target, `${target}.js`, `${target}.cjs`, `${target}/index.js`];
        if (!candidates.some((c) => entries.has(c))) missing.push(`${entry} -> ${m[1]}`);
      }
    }
    if (missing.length) for (const m of missing) fail(`app.asar is missing a required file: ${m}`);
    else ok('all local require() targets of electron/*.cjs are packaged in app.asar');
  } catch (err) {
    fail(`Could not inspect app.asar: ${err.message}`);
  }
} else {
  fail('win-unpacked/resources/app.asar missing');
}

// 3. Secrets
const SECRET_KEYS =
  /^(DB_PASSWORD|DB_USER|DATABASE_URL|SMTP_PASS(WORD)?|SMTP_USER|JWT_SECRET|SESSION_SECRET|ENCRYPTION_KEY|CONNECTOR_TOKEN|HIKVISION_PASSWORD|GH_TOKEN|GITHUB_TOKEN|CSC_LINK|CSC_KEY_PASSWORD|WIN_CSC_LINK|WIN_CSC_KEY_PASSWORD|INSFORGE_API_KEY|OWNER_SETUP_CODE|.*(SECRET|PASSWORD|TOKEN|API_KEY).*)$/i;
const TOKEN_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{36,}/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /-----BEGIN (RSA |EC |ENCRYPTED )?PRIVATE KEY-----/,
];

function parseEnv(file) {
  const out = [];
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^['"]|['"]$/g, '');
    out.push({ key: m[1], value });
  }
  return out;
}

const localSecrets = [];
for (const envFile of ['.env', 'server/.env', 'gateway/.env', '.env.local', 'server/.env.local']) {
  for (const { key, value } of parseEnv(path.join(root, envFile))) {
    if (SECRET_KEYS.test(key) && value.length >= 8) localSecrets.push({ key: `${envFile}:${key}`, value: Buffer.from(value) });
  }
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

if (fs.existsSync(resourcesDir)) {
  let scanned = 0;
  const leaked = new Set();
  for (const file of walk(resourcesDir)) {
    const base = path.basename(file);
    const rel = path.relative(resourcesDir, file);
    if (/^\.env(\..+)?$/i.test(base) && base.toLowerCase() !== '.env.example') fail(`Packaged env file: ${rel}`);
    if (base.toLowerCase() === '.env.example') {
      for (const { key, value } of parseEnv(file)) {
        const placeholder = !value || /your|change|example|replace|xxx|<|placeholder|localhost|127\.0\.0\.1/i.test(value);
        if (SECRET_KEYS.test(key) && !placeholder) fail(`${rel} has a non-placeholder value for ${key}`);
      }
    }
    const stat = fs.statSync(file);
    if (stat.size > 200 * 1024 * 1024) continue;
    const buf = fs.readFileSync(file);
    scanned += 1;
    const isOwnNodeModule = rel.includes(`${path.sep}node_modules${path.sep}`);
    if (!isOwnNodeModule) {
      const text = buf.toString('latin1');
      for (const re of TOKEN_PATTERNS) if (re.test(text)) fail(`${rel} matches secret pattern ${re.source.slice(0, 20)}…`);
    }
    for (const s of localSecrets) {
      if (!leaked.has(s.key) && buf.includes(s.value)) {
        leaked.add(s.key);
        fail(`Value of ${s.key} found in packaged file ${rel}`);
      }
    }
  }
  ok(`scanned ${scanned} packaged files for secrets (${localSecrets.length} local secret values checked)`);
} else {
  fail('win-unpacked/resources not found - cannot scan packaged files for secrets');
}

// 4. Code signing (informational)
if (process.platform === 'win32' && fs.existsSync(installer)) {
  const ps = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${installer.replace(/'/g, "''")}').Status`],
    { encoding: 'utf8' },
  );
  const status = (ps.stdout || '').trim() || 'unknown';
  notes.push(
    status === 'Valid'
      ? 'Installer has a valid Authenticode signature.'
      : `Installer signature status: ${status}. It is NOT code-signed; Windows SmartScreen may warn on first run.`,
  );
}

for (const n of notes) console.log(`  NOTE ${n}`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL ${f}`);
  console.error(`[verify-release] ${failures.length} problem(s) - do not publish this build.`);
  process.exit(1);
}
console.log('[verify-release] All checks passed.');
