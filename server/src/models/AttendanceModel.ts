/**
 * AttendanceModel — server-side CRUD for the `attendance` table.
 * The app_id column stores the client-generated ID (e.g. 'att-xxxx') for lookups.
 * The UUID `id` column is the true DB primary key.
 */
import { randomUUID } from 'node:crypto';
import { query } from '../db/pool.js';
import { isMysql } from '../db/dialect.js';

export interface AttendanceRow {
  id: string;           // UUID PK
  app_id: string | null; // client-generated id ('att-xxxx', 'att-dev-...')
  employee_id: string;
  department_id: string | null;
  date: string;         // ISO date string 'YYYY-MM-DD'
  shift_id: string | null;
  check_in: string | null;
  check_out: string | null;
  manual_check_in: string | null;
  manual_check_out: string | null;
  check_in_edited?: boolean;
  check_out_edited?: boolean;
  check_in_edited_by?: string | null;
  check_out_edited_by?: string | null;
  check_in_edited_at?: string | null;
  check_out_edited_at?: string | null;
  break_minutes: number;
  working_hours: number;
  overtime: number;
  late_minutes: number;
  status: string;
  location: string | null;
  remarks: string | null;
  manual_override: boolean;
  source: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function rowToAppRecord(row: AttendanceRow) {
  return {
    id: row.app_id ?? row.id,
    employeeId: row.employee_id,
    departmentId: row.department_id ?? '',
    date: typeof row.date === 'string' ? row.date.slice(0, 10) : new Date(row.date).toISOString().slice(0, 10),
    shiftId: row.shift_id ?? 's1',
    checkIn: row.check_in ?? undefined,
    checkOut: row.check_out ?? undefined,
    manualCheckIn: row.manual_check_in ?? undefined,
    manualCheckOut: row.manual_check_out ?? undefined,
    checkInEdited: row.check_in_edited ?? false,
    checkOutEdited: row.check_out_edited ?? false,
    checkInEditedBy: row.check_in_edited_by ?? undefined,
    checkOutEditedBy: row.check_out_edited_by ?? undefined,
    checkInEditedAt: row.check_in_edited_at ?? undefined,
    checkOutEditedAt: row.check_out_edited_at ?? undefined,
    breakMinutes: row.break_minutes ?? 0,
    workingHours: Number(row.working_hours ?? 0),
    overtime: Number(row.overtime ?? 0),
    lateMinutes: row.late_minutes ?? 0,
    status: row.status as any,
    location: row.location ?? undefined,
    remarks: row.remarks ?? undefined,
    manualOverride: row.manual_override ?? false,
    source: row.source ?? undefined,
    createdBy: row.created_by ?? 'system',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function idMatchSql(paramIndex: number): string {
  // MySQL has no `id::text`; CAST keeps UUID/CHAR comparisons working.
  return isMysql()
    ? `CAST(id AS CHAR) = $${paramIndex}`
    : `id::text = $${paramIndex}`;
}

export const AttendanceModel = {
  /** Fetch all attendance rows, ordered newest first */
  async getAll() {
    const res = await query<AttendanceRow>(
      `SELECT * FROM attendance ORDER BY date DESC, updated_at DESC`
    );
    return res.rows.map(rowToAppRecord);
  },

  /** Upsert by (employee_id, date) — used for device sync and app saves.
   * If app_id is provided and a row with that app_id already exists, update it.
   * Otherwise insert/update by (employee_id, date) unique constraint.
   */
  async upsert(record: {
    appId?: string;
    employeeId: string;
    departmentId?: string;
    date: string;
    shiftId?: string;
    checkIn?: string;
    checkOut?: string;
    manualCheckIn?: string;
    manualCheckOut?: string;
    checkInEdited?: boolean;
    checkOutEdited?: boolean;
    checkInEditedBy?: string;
    checkOutEditedBy?: string;
    checkInEditedAt?: string;
    checkOutEditedAt?: string;
    breakMinutes?: number;
    workingHours?: number;
    overtime?: number;
    lateMinutes?: number;
    status?: string;
    location?: string;
    remarks?: string;
    manualOverride?: boolean;
    createdBy?: string;
    source?: string;
  }) {
    const now = new Date().toISOString();
    const params = [
      record.appId ?? null,
      record.employeeId,
      record.departmentId ?? null,
      record.date,
      record.shiftId ?? null,
      record.checkIn ?? null,
      record.checkOut ?? null,
      record.manualCheckIn ?? null,
      record.manualCheckOut ?? null,
      record.checkInEdited ?? false,
      record.checkOutEdited ?? false,
      record.checkInEditedBy ?? null,
      record.checkOutEditedBy ?? null,
      record.checkInEditedAt ?? null,
      record.checkOutEditedAt ?? null,
      record.breakMinutes ?? 0,
      record.workingHours ?? 0,
      record.overtime ?? 0,
      record.lateMinutes ?? 0,
      record.status ?? 'present',
      record.location ?? null,
      record.remarks ?? null,
      record.manualOverride ?? false,
      record.source ?? null,
      record.createdBy ?? 'app',
      now,
    ];

    if (isMysql()) {
      const id = randomUUID();
      await query(
        `INSERT INTO attendance (
          id, app_id, employee_id, department_id, date, shift_id,
          check_in, check_out, manual_check_in, manual_check_out,
          check_in_edited, check_out_edited, check_in_edited_by, check_out_edited_by, check_in_edited_at, check_out_edited_at,
          break_minutes, working_hours, overtime, late_minutes, status, location, remarks,
          manual_override, source, created_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23,
          $24, $25, $26, $27, $27
        )
        ON DUPLICATE KEY UPDATE
          app_id              = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1, COALESCE(VALUES(app_id), attendance.app_id), attendance.app_id),
          department_id       = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1, COALESCE(VALUES(department_id), attendance.department_id), attendance.department_id),
          shift_id            = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1, COALESCE(VALUES(shift_id), attendance.shift_id), attendance.shift_id),
          check_in            = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1, VALUES(check_in), attendance.check_in),
          check_out           = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1, VALUES(check_out), attendance.check_out),
          manual_check_in     = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1,
                                IF(VALUES(manual_override) = 1, VALUES(manual_check_in), COALESCE(VALUES(manual_check_in), attendance.manual_check_in)),
                                attendance.manual_check_in),
          manual_check_out    = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1,
                                IF(VALUES(manual_override) = 1, VALUES(manual_check_out), COALESCE(VALUES(manual_check_out), attendance.manual_check_out)),
                                attendance.manual_check_out),
          check_in_edited     = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1,
                                IF(VALUES(manual_override) = 1, VALUES(check_in_edited), IF(VALUES(check_in_edited) = 1, 1, attendance.check_in_edited)),
                                attendance.check_in_edited),
          check_out_edited    = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1,
                                IF(VALUES(manual_override) = 1, VALUES(check_out_edited), IF(VALUES(check_out_edited) = 1, 1, attendance.check_out_edited)),
                                attendance.check_out_edited),
          check_in_edited_by  = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1,
                                IF(VALUES(manual_override) = 1, VALUES(check_in_edited_by), COALESCE(VALUES(check_in_edited_by), attendance.check_in_edited_by)),
                                attendance.check_in_edited_by),
          check_out_edited_by = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1,
                                IF(VALUES(manual_override) = 1, VALUES(check_out_edited_by), COALESCE(VALUES(check_out_edited_by), attendance.check_out_edited_by)),
                                attendance.check_out_edited_by),
          check_in_edited_at  = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1,
                                IF(VALUES(manual_override) = 1, VALUES(check_in_edited_at), COALESCE(VALUES(check_in_edited_at), attendance.check_in_edited_at)),
                                attendance.check_in_edited_at),
          check_out_edited_at = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1,
                                IF(VALUES(manual_override) = 1, VALUES(check_out_edited_at), COALESCE(VALUES(check_out_edited_at), attendance.check_out_edited_at)),
                                attendance.check_out_edited_at),
          break_minutes       = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1, VALUES(break_minutes), attendance.break_minutes),
          working_hours       = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1, VALUES(working_hours), attendance.working_hours),
          overtime            = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1, VALUES(overtime), attendance.overtime),
          late_minutes        = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1, VALUES(late_minutes), attendance.late_minutes),
          status              = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1, VALUES(status), attendance.status),
          location            = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1, COALESCE(VALUES(location), attendance.location), attendance.location),
          remarks             = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1, COALESCE(VALUES(remarks), attendance.remarks), attendance.remarks),
          manual_override     = IF(VALUES(manual_override) = 1, 1, attendance.manual_override),
          source              = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1, COALESCE(VALUES(source), attendance.source), attendance.source),
          created_by          = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1, COALESCE(VALUES(created_by), attendance.created_by), attendance.created_by),
          updated_at          = IF(attendance.manual_override = 0 OR VALUES(manual_override) = 1, VALUES(updated_at), attendance.updated_at)`,
        [id, ...params],
      );

      const existing = await query<AttendanceRow>(
        `SELECT * FROM attendance WHERE employee_id = $1 AND date = $2`,
        [record.employeeId, record.date],
      );
      return existing.rows[0] ? rowToAppRecord(existing.rows[0]) : null;
    }

    const res = await query<AttendanceRow>(
      `INSERT INTO attendance (
        app_id, employee_id, department_id, date, shift_id,
        check_in, check_out, manual_check_in, manual_check_out,
        check_in_edited, check_out_edited, check_in_edited_by, check_out_edited_by, check_in_edited_at, check_out_edited_at,
        break_minutes, working_hours, overtime, late_minutes, status, location, remarks,
        manual_override, source, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22,
        $23, $24, $25, $26, $26
      )
      ON CONFLICT (employee_id, date)
      DO UPDATE SET
        app_id              = COALESCE(EXCLUDED.app_id, attendance.app_id),
        department_id       = COALESCE(EXCLUDED.department_id, attendance.department_id),
        shift_id            = COALESCE(EXCLUDED.shift_id, attendance.shift_id),
        check_in            = EXCLUDED.check_in,
        check_out           = EXCLUDED.check_out,
        -- A manual save is authoritative per field (so clearing one time drops only
        -- its star); a device sync can only add markers, never wipe human edits.
        manual_check_in     = CASE WHEN EXCLUDED.manual_override = true
                                THEN EXCLUDED.manual_check_in
                                ELSE COALESCE(EXCLUDED.manual_check_in, attendance.manual_check_in) END,
        manual_check_out    = CASE WHEN EXCLUDED.manual_override = true
                                THEN EXCLUDED.manual_check_out
                                ELSE COALESCE(EXCLUDED.manual_check_out, attendance.manual_check_out) END,
        check_in_edited     = CASE WHEN EXCLUDED.manual_override = true
                                THEN EXCLUDED.check_in_edited
                                WHEN EXCLUDED.check_in_edited = true THEN true
                                ELSE attendance.check_in_edited END,
        check_out_edited    = CASE WHEN EXCLUDED.manual_override = true
                                THEN EXCLUDED.check_out_edited
                                WHEN EXCLUDED.check_out_edited = true THEN true
                                ELSE attendance.check_out_edited END,
        check_in_edited_by  = CASE WHEN EXCLUDED.manual_override = true
                                THEN EXCLUDED.check_in_edited_by
                                ELSE COALESCE(EXCLUDED.check_in_edited_by, attendance.check_in_edited_by) END,
        check_out_edited_by = CASE WHEN EXCLUDED.manual_override = true
                                THEN EXCLUDED.check_out_edited_by
                                ELSE COALESCE(EXCLUDED.check_out_edited_by, attendance.check_out_edited_by) END,
        check_in_edited_at  = CASE WHEN EXCLUDED.manual_override = true
                                THEN EXCLUDED.check_in_edited_at
                                ELSE COALESCE(EXCLUDED.check_in_edited_at, attendance.check_in_edited_at) END,
        check_out_edited_at = CASE WHEN EXCLUDED.manual_override = true
                                THEN EXCLUDED.check_out_edited_at
                                ELSE COALESCE(EXCLUDED.check_out_edited_at, attendance.check_out_edited_at) END,
        break_minutes       = EXCLUDED.break_minutes,
        working_hours       = EXCLUDED.working_hours,
        overtime            = EXCLUDED.overtime,
        late_minutes        = EXCLUDED.late_minutes,
        status              = EXCLUDED.status,
        location            = COALESCE(EXCLUDED.location, attendance.location),
        remarks             = COALESCE(EXCLUDED.remarks, attendance.remarks),
        manual_override     = CASE
          WHEN EXCLUDED.manual_override = true THEN true
          ELSE attendance.manual_override
        END,
        source              = COALESCE(EXCLUDED.source, attendance.source),
        created_by          = COALESCE(EXCLUDED.created_by, attendance.created_by),
        updated_at          = EXCLUDED.updated_at
      WHERE attendance.manual_override = false OR EXCLUDED.manual_override = true
      RETURNING *`,
      params,
    );
    if (!res.rows[0]) {
      // Conflict but no update (manualOverride guard) — fetch existing
      const existing = await query<AttendanceRow>(
        `SELECT * FROM attendance WHERE employee_id = $1 AND date = $2`,
        [record.employeeId, record.date]
      );
      return existing.rows[0] ? rowToAppRecord(existing.rows[0]) : null;
    }
    return rowToAppRecord(res.rows[0]);
  },

  /** Update specific fields by app_id or db id */
  async updateById(appId: string, patch: {
    checkIn?: string | null;
    checkOut?: string | null;
    manualCheckIn?: string | null;
    manualCheckOut?: string | null;
    checkInEdited?: boolean;
    checkOutEdited?: boolean;
    checkInEditedBy?: string | null;
    checkOutEditedBy?: string | null;
    checkInEditedAt?: string | null;
    checkOutEditedAt?: string | null;
    breakMinutes?: number;
    workingHours?: number;
    overtime?: number;
    lateMinutes?: number;
    status?: string;
    location?: string | null;
    remarks?: string | null;
    shiftId?: string | null;
    departmentId?: string | null;
    manualOverride?: boolean;
    date?: string;
    employeeId?: string;
  }) {
    const now = new Date().toISOString();
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    const add = (col: string, val: unknown) => {
      sets.push(`${col} = $${idx++}`);
      vals.push(val);
    };

    if (patch.checkIn !== undefined) add('check_in', patch.checkIn);
    if (patch.checkOut !== undefined) add('check_out', patch.checkOut);
    if (patch.manualCheckIn !== undefined) add('manual_check_in', patch.manualCheckIn);
    if (patch.manualCheckOut !== undefined) add('manual_check_out', patch.manualCheckOut);
    if (patch.checkInEdited !== undefined) add('check_in_edited', patch.checkInEdited);
    if (patch.checkOutEdited !== undefined) add('check_out_edited', patch.checkOutEdited);
    if (patch.checkInEditedBy !== undefined) add('check_in_edited_by', patch.checkInEditedBy);
    if (patch.checkOutEditedBy !== undefined) add('check_out_edited_by', patch.checkOutEditedBy);
    if (patch.checkInEditedAt !== undefined) add('check_in_edited_at', patch.checkInEditedAt);
    if (patch.checkOutEditedAt !== undefined) add('check_out_edited_at', patch.checkOutEditedAt);
    if (patch.breakMinutes !== undefined) add('break_minutes', patch.breakMinutes);
    if (patch.workingHours !== undefined) add('working_hours', patch.workingHours);
    if (patch.overtime !== undefined) add('overtime', patch.overtime);
    if (patch.lateMinutes !== undefined) add('late_minutes', patch.lateMinutes);
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.location !== undefined) add('location', patch.location);
    if (patch.remarks !== undefined) add('remarks', patch.remarks);
    if (patch.shiftId !== undefined) add('shift_id', patch.shiftId);
    if (patch.departmentId !== undefined) add('department_id', patch.departmentId);
    if (patch.manualOverride !== undefined) add('manual_override', patch.manualOverride);
    if (patch.date !== undefined) add('date', patch.date);
    if (patch.employeeId !== undefined) add('employee_id', patch.employeeId);

    sets.push(`updated_at = $${idx++}`);
    vals.push(now);

    // Match by app_id first, then by UUID
    vals.push(appId);
    const match = `app_id = $${idx} OR ${idMatchSql(idx)}`;

    if (isMysql()) {
      await query(
        `UPDATE attendance SET ${sets.join(', ')} WHERE ${match}`,
        vals,
      );
      const res = await query<AttendanceRow>(
        `SELECT * FROM attendance WHERE app_id = $1 OR ${idMatchSql(1)}`,
        [appId],
      );
      return res.rows[0] ? rowToAppRecord(res.rows[0]) : null;
    }

    const res = await query<AttendanceRow>(
      `UPDATE attendance SET ${sets.join(', ')}
       WHERE ${match}
       RETURNING *`,
      vals
    );
    return res.rows[0] ? rowToAppRecord(res.rows[0]) : null;
  },

  /** Delete by app_id or db id */
  async deleteById(appId: string) {
    await query(
      `DELETE FROM attendance WHERE app_id = $1 OR ${idMatchSql(1)}`,
      [appId]
    );
  },

  /** Bulk upsert — used when saving many draft records at once */
  async bulkUpsert(records: {
    appId?: string;
    employeeId: string;
    departmentId?: string;
    date: string;
    shiftId?: string;
    checkIn?: string;
    checkOut?: string;
    breakMinutes?: number;
    workingHours?: number;
    overtime?: number;
    lateMinutes?: number;
    status?: string;
    location?: string;
    remarks?: string;
    manualOverride?: boolean;
    createdBy?: string;
    source?: string;
  }[]) {
    const results = await Promise.all(records.map((r) => AttendanceModel.upsert(r)));
    return results.filter(Boolean);
  },

  /** Update many records by their app_id — used for bulk edit in the table */
  async updateMany(appIds: string[], patch: {
    checkIn?: string | null;
    checkOut?: string | null;
    breakMinutes?: number;
    workingHours?: number;
    overtime?: number;
    lateMinutes?: number;
    status?: string;
    location?: string | null;
    remarks?: string | null;
    shiftId?: string | null;
    departmentId?: string | null;
    manualOverride?: boolean;
    date?: string;
    employeeId?: string;
  }) {
    const results = await Promise.all(appIds.map((id) => AttendanceModel.updateById(id, patch)));
    return results.filter(Boolean);
  },
};
