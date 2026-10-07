/**
 * Device-credential encryption key, protected by the operating system.
 *
 * The local API encrypts the attendance machine password with AES-256-GCM
 * (server/src/services/crypto/passwordCrypto.ts). The key for that cipher is
 * kept here, sealed with Electron safeStorage — Windows DPAPI, bound to the
 * signed-in Windows user — instead of as plain text in server.env.
 *
 * The key is handed to the local API process through its environment at spawn
 * time and is never written to logs.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY_FILE_NAME = 'device-key.dpapi';

function isValidKey(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
}

/**
 * @param {object} opts
 * @param {import('electron').SafeStorage} opts.safeStorage
 * @param {string} opts.userDataDir
 * @param {string | undefined} opts.legacyKey ENCRYPTION_KEY found in server.env, if any.
 * @param {(msg: string) => void} opts.log
 * @returns {{ key: string, osProtected: boolean, source: 'dpapi' | 'migrated' | 'generated' | 'legacy-plaintext' }}
 */
function loadDeviceCredentialKey({ safeStorage, userDataDir, legacyKey, log }) {
  const secureDir = path.join(userDataDir, 'secure');
  const keyPath = path.join(secureDir, KEY_FILE_NAME);
  const available = Boolean(safeStorage && safeStorage.isEncryptionAvailable());

  if (!available) {
    log('[SecureKey] OS credential protection unavailable; keeping key in server.env');
    if (isValidKey(legacyKey)) return { key: legacyKey, osProtected: false, source: 'legacy-plaintext' };
    return {
      key: crypto.randomBytes(32).toString('hex'),
      osProtected: false,
      source: 'generated',
    };
  }

  if (fs.existsSync(keyPath)) {
    try {
      const key = safeStorage.decryptString(fs.readFileSync(keyPath));
      // A key typed into server.env by an operator takes precedence and is re-sealed.
      if (isValidKey(key) && (!isValidKey(legacyKey) || legacyKey === key)) {
        return { key, osProtected: true, source: 'dpapi' };
      }
      if (!isValidKey(key)) log('[SecureKey] Protected key file is malformed');
    } catch (err) {
      log(`[SecureKey] Could not unseal protected key: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Keep the previous file for support rather than deleting it.
    try {
      fs.renameSync(keyPath, `${keyPath}.previous-${Date.now()}`);
    } catch {
      /* ignore */
    }
  }

  const source = isValidKey(legacyKey) ? 'migrated' : 'generated';
  const key = source === 'migrated' ? legacyKey : crypto.randomBytes(32).toString('hex');

  fs.mkdirSync(secureDir, { recursive: true });
  const sealed = safeStorage.encryptString(key);
  const tmpPath = `${keyPath}.tmp`;
  fs.writeFileSync(tmpPath, sealed);
  // Refuse to rely on the sealed copy until it round-trips.
  if (safeStorage.decryptString(fs.readFileSync(tmpPath)) !== key) {
    fs.rmSync(tmpPath, { force: true });
    throw new Error('Protected key verification failed');
  }
  fs.renameSync(tmpPath, keyPath);
  log(`[SecureKey] Device credential key stored with OS protection (${source})`);
  return { key, osProtected: true, source };
}

/**
 * Remove ENCRYPTION_KEY from server.env once the key lives in protected storage.
 * Other lines (database settings, comments) are left untouched.
 */
function stripPlaintextKeyFromEnvFile(envPath, log) {
  if (!fs.existsSync(envPath)) return false;
  const text = fs.readFileSync(envPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((line) => !/^\s*ENCRYPTION_KEY\s*=/.test(line));
  if (kept.length === lines.length) return false;
  kept.push('# ENCRYPTION_KEY is stored with Windows credential protection (secure/device-key.dpapi).');
  const tmpPath = `${envPath}.tmp`;
  fs.writeFileSync(tmpPath, `${kept.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
  fs.renameSync(tmpPath, envPath);
  log('[SecureKey] Removed plaintext ENCRYPTION_KEY from server.env');
  return true;
}

module.exports = { loadDeviceCredentialKey, stripPlaintextKeyFromEnvFile, isValidKey };
