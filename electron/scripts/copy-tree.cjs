/**
 * Directory copy that hydrates OneDrive Files On-Demand placeholders.
 *
 * Dirent.isFile() is false for unhydrated cloud files (reparse points), so a
 * naive "if (entry.isFile()) copy" silently skips them. That shipped an
 * installer whose dist/routes/ folder existed but deviceRoutes.js was missing.
 */
'use strict';

const fs = require('fs');
const path = require('path');

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isConflictName(name) {
  return /-DESKTOP-[A-Z0-9]+\./i.test(name) || /conflict/i.test(name);
}

function copyFileWithRetry(from, to, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.copyFileSync(from, to);
      return;
    } catch (err) {
      lastErr = err;
      sleep(500 * (i + 1));
    }
  }
  throw lastErr;
}

/**
 * @param {string} src
 * @param {string} dest
 * @param {{ skipTests?: boolean }} [opts]
 */
function copyDir(src, dest, opts = {}) {
  const skipTests = opts.skipTests === true;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (isConflictName(name)) {
      console.warn(`[copy-tree] Skipping ${name}`);
      continue;
    }
    if (skipTests && /\.test\.js$/i.test(name)) continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    // statSync follows / hydrates OneDrive placeholders; Dirent.isFile() does not.
    const st = fs.statSync(from);
    if (st.isDirectory()) copyDir(from, to, opts);
    else copyFileWithRetry(from, to);
  }
}

/**
 * @param {string} dir
 * @param {string} [base]
 * @param {{ skipTests?: boolean }} [opts]
 * @returns {string[]}
 */
function listRelFiles(dir, base = dir, opts = {}) {
  const skipTests = opts.skipTests === true;
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (isConflictName(name)) continue;
    if (skipTests && /\.test\.js$/i.test(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...listRelFiles(p, base, opts));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/**
 * @param {string} src
 * @param {string} dest
 * @param {string} label
 * @param {{ skipTests?: boolean }} [opts]
 */
function assertCopied(src, dest, label, opts = {}) {
  const missing = [];
  for (const rel of listRelFiles(src, src, opts)) {
    const target = path.join(dest, rel);
    if (!fs.existsSync(target) || fs.statSync(target).size === 0) missing.push(rel);
  }
  if (missing.length) {
    throw new Error(
      `[${label}] Missing ${missing.length} file(s) after copy, including: ${missing.slice(0, 20).join(', ')}`,
    );
  }
}

const REQUIRED_DIST_FILES = [
  'index.js',
  'app.js',
  'routes/deviceRoutes.js',
  'routes/authRoutes.js',
  'routes/attendanceRoutes.js',
  'routes/coreRoutes.js',
  'routes/gatewayRoutes.js',
  'middleware/authMiddleware.js',
  'controllers/deviceController.js',
  'controllers/authController.js',
];

/**
 * @param {string} distDir
 * @param {string} label
 */
function assertServerDist(distDir, label) {
  const missing = REQUIRED_DIST_FILES.filter((rel) => {
    const target = path.join(distDir, rel);
    return !fs.existsSync(target) || fs.statSync(target).size === 0;
  });
  if (missing.length) {
    throw new Error(`[${label}] Incomplete server dist at ${distDir}. Missing: ${missing.join(', ')}`);
  }
}

module.exports = {
  copyDir,
  assertCopied,
  assertServerDist,
  listRelFiles,
  REQUIRED_DIST_FILES,
};
