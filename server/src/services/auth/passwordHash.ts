import bcrypt from 'bcryptjs';

const BCRYPT_COST = 10;

function looksLikeBcrypt(value: string): boolean {
  return typeof value === 'string' && /^\$2[aby]?\$/.test(value);
}

/** Hash a plaintext password for storage (bcrypt cost 10). Skips re-hashing existing bcrypt values. */
export async function hashPassword(plain: string): Promise<string> {
  if (looksLikeBcrypt(plain)) return plain;
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Verify a plaintext password against a stored credential.
 * Bcrypt hashes ($2...) use compare; legacy plaintext uses equality.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (looksLikeBcrypt(stored)) {
    return bcrypt.compare(plain, stored);
  }
  return plain === stored;
}

export { looksLikeBcrypt };
