import { createClient } from '@insforge/sdk';

const baseUrl = (import.meta.env.VITE_INSFORGE_URL ?? '').trim().replace(/\/$/, '');
const anonKey = (import.meta.env.VITE_INSFORGE_ANON_KEY ?? '').trim();

export function isInsforgeBrowserConfigured(): boolean {
  return Boolean(baseUrl && anonKey);
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
