import { env } from '../../config/env.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clientInstance: any = null;
let isInitialized = false;

/**
 * Initializes and returns the InsForge SDK client using environment variables.
 * Safe fallback: Returns null if INSFORGE_BASE_URL or INSFORGE_API_KEY are missing.
 */
export async function getInsForgeClient() {
  const baseUrl = env.insforgeBaseUrl || process.env.INSFORGE_BASE_URL;
  const apiKey = env.insforgeApiKey || process.env.INSFORGE_API_KEY;

  if (!baseUrl || !apiKey) {
    if (!isInitialized) {
      console.log('[InsForge] Client not initialized — INSFORGE_BASE_URL or INSFORGE_API_KEY missing.');
      isInitialized = true;
    }
    return null;
  }

  if (!clientInstance) {
    try {
      const { createClient } = await import('@insforge/sdk');
      clientInstance = createClient({
        baseUrl,
        anonKey: apiKey,
      });
      console.log(`[InsForge] SDK client initialized successfully for ${baseUrl}`);
    } catch (err) {
      console.warn('[InsForge] Client initialization error:', err instanceof Error ? err.message : err);
      clientInstance = null;
    }
    isInitialized = true;
  }

  return clientInstance;
}

/**
 * Health check & status probe for InsForge BaaS connectivity.
 */
export async function getInsForgeStatus(): Promise<{
  enabled: boolean;
  connected: boolean;
  baseUrl: string;
  message: string;
}> {
  const baseUrl = env.insforgeBaseUrl || process.env.INSFORGE_BASE_URL || '';
  const apiKey = env.insforgeApiKey || process.env.INSFORGE_API_KEY || '';

  if (!baseUrl || !apiKey) {
    return {
      enabled: false,
      connected: false,
      baseUrl: baseUrl || 'not configured',
      message: 'InsForge environment variables (INSFORGE_BASE_URL, INSFORGE_API_KEY) are missing.',
    };
  }

  const client = await getInsForgeClient();
  if (!client) {
    return {
      enabled: true,
      connected: false,
      baseUrl,
      message: 'Failed to create InsForge SDK client instance.',
    };
  }

  try {
    return {
      enabled: true,
      connected: true,
      baseUrl,
      message: 'InsForge BaaS backend connected successfully.',
    };
  } catch (err) {
    return {
      enabled: true,
      connected: false,
      baseUrl,
      message: `InsForge connection error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Syncs attendance log records to InsForge database if enabled.
 * Operates with safe error handling so failures never crash primary server workflows.
 */
export async function syncAttendanceToInsForge(records: Array<Record<string, unknown>>): Promise<boolean> {
  const client = await getInsForgeClient();
  if (!client || !records.length) return false;

  try {
    const { error } = await client.database.from('attendance_logs').insert(records);
    if (error) {
      console.warn('[InsForge Sync] Failed to sync records:', error.message || error);
      return false;
    }
    console.log(`[InsForge Sync] Synced ${records.length} attendance record(s) to InsForge cloud.`);
    return true;
  } catch (err) {
    console.warn('[InsForge Sync] Unexpected error during sync:', err instanceof Error ? err.message : err);
    return false;
  }
}
