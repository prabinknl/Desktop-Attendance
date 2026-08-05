import { query } from '../db/pool.js';
import { isMemoryMode, memoryStore, type InvitationRecord } from '../db/memoryStore.js';

export const InvitationModel = {
  async save(inv: InvitationRecord): Promise<void> {
    memoryStore.saveInvitation(inv);
    if (isMemoryMode()) return;

    try {
      await query(
        `INSERT INTO app_invitations (token, email, role, created_at, expires_at, used)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (token) DO UPDATE SET
           email = EXCLUDED.email,
           role = EXCLUDED.role,
           expires_at = EXCLUDED.expires_at,
           used = EXCLUDED.used`,
        [inv.token, inv.email.toLowerCase(), inv.role, inv.created_at, inv.expires_at, inv.used],
      );
    } catch (err) {
      console.warn('[InvitationModel] DB save error, falling back to memory store:', err instanceof Error ? err.message : err);
    }
  },

  async getByToken(token: string): Promise<InvitationRecord | null> {
    if (!token) return null;

    if (!isMemoryMode()) {
      try {
        const res = await query<InvitationRecord>(
          'SELECT token, email, role, created_at, expires_at, used FROM app_invitations WHERE token = $1 LIMIT 1',
          [token],
        );
        if (res.rows[0]) {
          return {
            token: res.rows[0].token,
            email: res.rows[0].email,
            role: res.rows[0].role,
            created_at: res.rows[0].created_at,
            expires_at: res.rows[0].expires_at,
            used: Boolean(res.rows[0].used),
          };
        }
      } catch (err) {
        console.warn('[InvitationModel] DB get error, falling back to memory store:', err instanceof Error ? err.message : err);
      }
    }

    return memoryStore.getInvitation(token);
  },

  async markUsed(token: string): Promise<void> {
    memoryStore.markInvitationUsed(token);
    if (isMemoryMode()) return;

    try {
      await query('UPDATE app_invitations SET used = true WHERE token = $1', [token]);
    } catch (err) {
      console.warn('[InvitationModel] DB markUsed error:', err instanceof Error ? err.message : err);
    }
  },
};
