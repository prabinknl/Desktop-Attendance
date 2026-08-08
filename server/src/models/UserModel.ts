import { query } from '../db/pool.js';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  password: string;
  avatar: string | null;
  phone: string | null;
  timezone: string | null;
  employee_id: string | null;
  department_id: string | null;
  client_id?: string | null;
  plan_type?: string | null;
  access_expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

function toIso(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  } catch {
    return undefined;
  }
}

function rowToAppUser(row: UserRow) {
  const planRaw = (row.plan_type ?? '').toLowerCase();
  const planType = planRaw === 'paid' ? 'paid' : planRaw === 'free' ? 'free' : undefined;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as any,
    password: row.password,
    avatar: row.avatar ?? undefined,
    phone: row.phone ?? undefined,
    timezone: row.timezone ?? undefined,
    employeeId: row.employee_id ?? undefined,
    departmentId: row.department_id ?? undefined,
    clientId: row.client_id ?? undefined,
    planType,
    accessExpiresAt: toIso(row.access_expires_at),
    createdAt: toIso(row.created_at),
  };
}

/** Same shape as rowToAppUser but without the credential. */
function rowToSafeUser(row: UserRow) {
  const { password: _password, ...safe } = rowToAppUser(row);
  return safe;
}

export const UserModel = {
  /** Fetch all registered user accounts from cloud DB */
  async getAll() {
    try {
      const res = await query<UserRow>('SELECT * FROM app_users ORDER BY created_at ASC');
      return res.rows.map(rowToAppUser);
    } catch (err) {
      console.warn('[UserModel] getAll error:', err);
      return [];
    }
  },

  /** Account list for the client. The API is reachable from the public
   *  internet, so passwords must never be part of a read response. */
  async getAllSafe() {
    try {
      const res = await query<UserRow>('SELECT * FROM app_users ORDER BY created_at ASC');
      return res.rows.map(rowToSafeUser);
    } catch (err) {
      console.warn('[UserModel] getAllSafe error:', err);
      return [];
    }
  },

  /** Check a login by email or display name. Returns the account without its
   *  password, or null when the credentials do not match. */
  async verifyCredentials(identifier: string, password: string) {
    const key = identifier.trim().toLowerCase();
    if (!key) return null;
    try {
      const res = await query<UserRow>(
        `SELECT * FROM app_users
         WHERE (LOWER(email) = $1 OR LOWER(TRIM(name)) = $1) AND password = $2
         LIMIT 1`,
        [key, password],
      );
      return res.rows[0] ? rowToSafeUser(res.rows[0]) : null;
    } catch (err) {
      console.warn('[UserModel] verifyCredentials error:', err);
      return null;
    }
  },

  /** Upsert user account (insert or update on email conflict) */
  async upsert(user: {
    id: string;
    name: string;
    email: string;
    role: string;
    password: string;
    avatar?: string;
    phone?: string;
    timezone?: string;
    employeeId?: string;
    departmentId?: string;
    clientId?: string;
    client_id?: string;
    planType?: 'free' | 'paid';
    plan_type?: 'free' | 'paid' | string;
    accessExpiresAt?: string;
    access_expires_at?: string;
  }) {
    const now = new Date().toISOString();
    const emailLower = user.email.trim().toLowerCase();
    const clientId = user.clientId ?? user.client_id ?? null;
    const planRaw = String(user.planType ?? user.plan_type ?? '').toLowerCase();
    const planType = planRaw === 'paid' ? 'paid' : planRaw === 'free' ? 'free' : null;
    const accessExpiresAt = user.accessExpiresAt ?? user.access_expires_at ?? null;

    // If role is admin, replace any existing admin row to enforce 1 admin total
    if (user.role === 'admin') {
      try {
        await query('DELETE FROM app_users WHERE role = $1 AND LOWER(email) <> $2', ['admin', emailLower]);
      } catch {}
    }

    const res = await query<UserRow>(
      `INSERT INTO app_users (
        id, name, email, role, password, avatar, phone, timezone, employee_id, department_id,
        client_id, plan_type, access_expires_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $14
      )
      ON CONFLICT (email)
      DO UPDATE SET
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        password = EXCLUDED.password,
        avatar = COALESCE(EXCLUDED.avatar, app_users.avatar),
        phone = COALESCE(EXCLUDED.phone, app_users.phone),
        timezone = COALESCE(EXCLUDED.timezone, app_users.timezone),
        employee_id = COALESCE(EXCLUDED.employee_id, app_users.employee_id),
        department_id = COALESCE(EXCLUDED.department_id, app_users.department_id),
        client_id = COALESCE(EXCLUDED.client_id, app_users.client_id),
        plan_type = COALESCE(EXCLUDED.plan_type, app_users.plan_type),
        access_expires_at = COALESCE(EXCLUDED.access_expires_at, app_users.access_expires_at),
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        user.id,
        user.name,
        emailLower,
        user.role,
        user.password,
        user.avatar ?? null,
        user.phone ?? null,
        user.timezone ?? null,
        user.employeeId ?? null,
        user.departmentId ?? null,
        clientId,
        planType,
        accessExpiresAt,
        now,
      ]
    );

    return res.rows[0] ? rowToAppUser(res.rows[0]) : null;
  },

  /** Delete user account by id */
  async deleteById(id: string) {
    try {
      await query('DELETE FROM app_users WHERE id = $1', [id]);
    } catch {}
  },
};
