import { query } from '../db/pool.js';
import { isMemoryMode, memoryStore, type InvitationRecord } from '../db/memoryStore.js';
import { hashValue, toIsoTimestamp } from '../services/auth/invitationService.js';

const DB_QUERY_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Database timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function normalizeInvitationRecord(row: any): InvitationRecord {
  return {
    ...row,
    created_at: toIsoTimestamp(row.created_at),
    expires_at: toIsoTimestamp(row.expires_at),
    access_start_at: row.access_start_at ? toIsoTimestamp(row.access_start_at) : undefined,
    access_expires_at: row.access_expires_at ? toIsoTimestamp(row.access_expires_at) : undefined,
    sms_expires_at: row.sms_expires_at ? toIsoTimestamp(row.sms_expires_at) : undefined,
    sms_last_sent_at: row.sms_last_sent_at ? toIsoTimestamp(row.sms_last_sent_at) : undefined,
    updated_at: row.updated_at ? toIsoTimestamp(row.updated_at) : undefined,
    used: Boolean(row.used),
  };
}

export const InvitationModel = {
  async save(inv: InvitationRecord): Promise<void> {
    memoryStore.saveInvitation(inv);
    if (isMemoryMode()) return;

    try {
      await query(
        `INSERT INTO app_invitations (
          token, email, role, created_at, expires_at, used,
          id, client_id, phone, company_name, plan_type, duration_days,
          access_start_at, access_expires_at, token_hash, sms_code_hash,
          sms_expires_at, sms_attempts, sms_last_sent_at, status, created_by, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22
        )
        ON CONFLICT (token) DO UPDATE SET
          email = EXCLUDED.email,
          role = EXCLUDED.role,
          created_at = EXCLUDED.created_at,
          expires_at = EXCLUDED.expires_at,
          used = EXCLUDED.used,
          client_id = EXCLUDED.client_id,
          phone = EXCLUDED.phone,
          company_name = EXCLUDED.company_name,
          plan_type = EXCLUDED.plan_type,
          duration_days = EXCLUDED.duration_days,
          access_start_at = EXCLUDED.access_start_at,
          access_expires_at = EXCLUDED.access_expires_at,
          token_hash = EXCLUDED.token_hash,
          sms_code_hash = EXCLUDED.sms_code_hash,
          sms_expires_at = EXCLUDED.sms_expires_at,
          sms_attempts = EXCLUDED.sms_attempts,
          sms_last_sent_at = EXCLUDED.sms_last_sent_at,
          status = EXCLUDED.status,
          created_by = EXCLUDED.created_by,
          updated_at = EXCLUDED.updated_at`,
        [
          inv.token,
          inv.email.toLowerCase(),
          inv.role,
          inv.created_at,
          inv.expires_at,
          inv.used,
          inv.id ?? null,
          inv.client_id ?? null,
          inv.phone ?? null,
          inv.company_name ?? null,
          inv.plan_type ?? 'free',
          inv.duration_days ?? null,
          inv.access_start_at ?? null,
          inv.access_expires_at ?? null,
          inv.token_hash ?? null,
          inv.sms_code_hash ?? null,
          inv.sms_expires_at ?? null,
          inv.sms_attempts ?? 0,
          inv.sms_last_sent_at ?? null,
          inv.status ?? 'pending',
          inv.created_by ?? null,
          inv.updated_at ?? inv.created_at,
        ],
      );
    } catch (err) {
      console.warn('[InvitationModel] DB save error, falling back to memory store:', err instanceof Error ? err.message : err);
    }
  },

  async getByToken(token: string): Promise<InvitationRecord | null> {
    if (!token) return null;

    if (!isMemoryMode()) {
      try {
        const res = await withTimeout(
          query<any>(
            'SELECT * FROM app_invitations WHERE token = $1 OR token_hash = $1 LIMIT 1',
            [token],
          ),
          DB_QUERY_TIMEOUT_MS,
        );
        if (res.rows[0]) {
          return normalizeInvitationRecord(res.rows[0]);
        }
      } catch (err) {
        console.warn('[InvitationModel] DB get error, falling back to memory store:', err instanceof Error ? err.message : err);
      }
    }

    const cached = memoryStore.getInvitation(token) || memoryStore.getInvitationByTokenHash(token);
    return cached ? normalizeInvitationRecord(cached) : null;
  },

  async getByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    if (!tokenHash) return null;

    if (!isMemoryMode()) {
      try {
        const res = await withTimeout(
          query<any>(
            'SELECT * FROM app_invitations WHERE token_hash = $1 OR token = $1 LIMIT 1',
            [tokenHash],
          ),
          DB_QUERY_TIMEOUT_MS,
        );
        if (res.rows[0]) {
          return normalizeInvitationRecord(res.rows[0]);
        }
      } catch (err) {
        console.warn('[InvitationModel] DB getByTokenHash error, falling back to memory store:', err instanceof Error ? err.message : err);
      }
    }

    const cached = memoryStore.getInvitationByTokenHash(tokenHash) || memoryStore.getInvitation(tokenHash);
    return cached ? normalizeInvitationRecord(cached) : null;
  },

  async getPendingByEmailAndRole(email: string, role: string): Promise<InvitationRecord | null> {
    const norm = email.trim().toLowerCase();
    if (!isMemoryMode()) {
      try {
        const res = await query<any>(
          `SELECT * FROM app_invitations
           WHERE LOWER(email) = $1 AND role = $2 AND (status IS NULL OR status = 'pending') AND used = false
           ORDER BY created_at DESC LIMIT 1`,
          [norm, role],
        );
        if (res.rows[0]) {
          return normalizeInvitationRecord(res.rows[0]);
        }
      } catch (err) {
        console.warn('[InvitationModel] DB getPendingByEmailAndRole error:', err instanceof Error ? err.message : err);
      }
    }

    const cached = memoryStore.getPendingInvitationByEmail(email, role);
    return cached ? normalizeInvitationRecord(cached) : null;
  },

  async updateSmsCode(tokenHash: string, smsCodeHash: string, smsExpiresAt: string): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.getByTokenHash(tokenHash);
    if (existing) {
      existing.sms_code_hash = smsCodeHash;
      existing.sms_expires_at = smsExpiresAt;
      existing.sms_attempts = 0;
      existing.sms_last_sent_at = now;
      existing.updated_at = now;
      await this.save(existing);
    }
  },

  async incrementSmsAttempt(tokenHash: string): Promise<number> {
    const existing = await this.getByTokenHash(tokenHash);
    if (!existing) return 0;
    const attempts = (existing.sms_attempts ?? 0) + 1;
    existing.sms_attempts = attempts;
    existing.updated_at = new Date().toISOString();
    await this.save(existing);
    return attempts;
  },

  async getBySmsCodeHash(smsCodeHash: string): Promise<InvitationRecord | null> {
    if (!smsCodeHash) return null;

    if (!isMemoryMode()) {
      try {
        const res = await withTimeout(
          query<any>(
            'SELECT * FROM app_invitations WHERE sms_code_hash = $1 LIMIT 1',
            [smsCodeHash],
          ),
          DB_QUERY_TIMEOUT_MS,
        );
        if (res.rows[0]) {
          return normalizeInvitationRecord(res.rows[0]);
        }
      } catch (err) {
        console.warn('[InvitationModel] DB getBySmsCodeHash error, falling back to memory store:', err instanceof Error ? err.message : err);
      }
    }

    const cached = memoryStore.getInvitationBySmsCodeHash(smsCodeHash);
    return cached ? normalizeInvitationRecord(cached) : null;
  },

  /**
   * Resolve an owner-provided invitation code without listing invitations.
   * Accepts the raw token, its hash, or the hashed 6-digit owner code.
   */
  async getByCode(code: string): Promise<{ inv: InvitationRecord; matchedBy: 'token' | 'sms' } | null> {
    const trimmed = String(code ?? '').trim();
    if (!trimmed || trimmed.length < 6) return null;

    const hashed = hashValue(trimmed);
    const byToken = await this.getByToken(trimmed);
    if (byToken) return { inv: byToken, matchedBy: 'token' };

    const byTokenHash = await this.getByTokenHash(hashed);
    if (byTokenHash) return { inv: byTokenHash, matchedBy: 'token' };

    const bySms = await this.getBySmsCodeHash(hashed);
    if (bySms) return { inv: bySms, matchedBy: 'sms' };

    return null;
  },

  async markUsed(token: string): Promise<void> {
    memoryStore.markInvitationUsed(token);
    if (isMemoryMode()) return;

    try {
      await query(
        `UPDATE app_invitations SET used = true, status = 'accepted', updated_at = NOW() WHERE token = $1 OR token_hash = $1`,
        [token],
      );
    } catch (err) {
      console.warn('[InvitationModel] DB markUsed error:', err instanceof Error ? err.message : err);
    }
  },
};
