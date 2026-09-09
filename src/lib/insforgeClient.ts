/** OBSOLETE after Hostinger MySQL migration is verified — kept as temporary browser fallback.
 * Prefer the Hostinger API (VITE_API_BASE_URL). Gate InsForge OTP behind VITE_USE_INSFORGE_OTP=true.
 */
import { createClient } from '@insforge/sdk';

const baseUrl = (import.meta.env.VITE_INSFORGE_URL ?? '').trim().replace(/\/$/, '');
const anonKey = (import.meta.env.VITE_INSFORGE_ANON_KEY ?? '').trim();

export function isInsforgeBrowserConfigured(): boolean {
  return Boolean(baseUrl && anonKey);
}

/** Explicit opt-in for legacy InsForge OTP during migration. */
export function useInsforgeOtp(): boolean {
  return import.meta.env.VITE_USE_INSFORGE_OTP === 'true' && isInsforgeBrowserConfigured();
}

let client: ReturnType<typeof createClient> | null = null;

export function getInsforgeBrowserClient() {
  if (!isInsforgeBrowserConfigured()) {
    throw new Error('InsForge is not configured for this build.');
  }
  if (!client) {
    client = createClient({ baseUrl, anonKey });
  }
  return client;
}
