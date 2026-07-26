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
  created_at: string;
  updated_at: string;
}

function rowToAppUser(row: UserRow) {
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
  };
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
  }) {
    const now = new Date().toISOString();
    const emailLower = user.email.trim().toLowerCase();

    // If role is admin, replace any existing admin row to enforce 1 admin total
    if (user.role === 'admin') {
      try {
        await query('DELETE FROM app_users WHERE role = $1 AND LOWER(email) <> $2', ['admin', emailLower]);
      } catch {}
    }

    const res = await query<UserRow>(
      `INSERT INTO app_users (
        id, name, email, role, password, avatar, phone, timezone, employee_id, department_id, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11
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
