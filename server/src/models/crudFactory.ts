/**
 * Builds a table-backed CRUD model from a column map.
 * The six core entities (departments, shifts, holidays, employees, leave
 * requests, punch requests) all use client-generated TEXT ids and are written
 * whole-object from the app, so they share one implementation rather than
 * repeating the same INSERT ... ON CONFLICT for each table.
 */
import { query } from '../db/pool.js';

export interface ColumnSpec {
  /** Postgres column name. */
  col: string;
  /** camelCase field name on the app-side object. */
  field: string;
  /** JSONB column — value is stringified on write, passed through on read. */
  json?: boolean;
  /** DATE column — trimmed to 'YYYY-MM-DD' on read. */
  date?: boolean;
  /** NUMERIC column — coerced with Number() on read. */
  number?: boolean;
  /** Written when the app object has no value for this field. A function is
   *  called per write, so timestamp defaults are not frozen at module load. */
  fallback?: unknown | (() => unknown);
}

/** Timestamp default for created_at / updated_at columns. */
export const nowIso = () => new Date().toISOString();

type Row = Record<string, unknown>;
type AppObject = Record<string, unknown>;

function toDateString(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function createCrudModel(opts: {
  table: string;
  columns: ColumnSpec[];
  /** ORDER BY clause used by getAll, without the keyword. */
  orderBy: string;
  /** Set on every write when the table has an updated_at column. */
  touchUpdatedAt?: boolean;
}) {
  const { table, columns, orderBy, touchUpdatedAt } = opts;

  function rowToApp(row: Row): AppObject {
    const out: AppObject = {};
    for (const spec of columns) {
      const raw = row[spec.col];
      if (raw === null || raw === undefined) continue;
      if (spec.date) out[spec.field] = toDateString(raw);
      else if (spec.number) out[spec.field] = Number(raw);
      else out[spec.field] = raw;
    }
    return out;
  }

  function toColumnValue(spec: ColumnSpec, source: AppObject): unknown {
    const value = source[spec.field];
    const useFallback = value === undefined || value === '';
    const resolved = useFallback
      ? typeof spec.fallback === 'function'
        ? (spec.fallback as () => unknown)()
        : spec.fallback
      : value;
    if (resolved === undefined) return null;
    if (spec.json) return JSON.stringify(resolved);
    return resolved;
  }

  return {
    async getAll() {
      const res = await query<Row>(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
      return res.rows.map(rowToApp);
    },

    /** Insert, or overwrite every non-id column when the id already exists. */
    async upsert(record: AppObject) {
      const source = touchUpdatedAt
        ? { ...record, updatedAt: new Date().toISOString() }
        : record;

      const values = columns.map((spec) => toColumnValue(spec, source));
      const placeholders = columns.map((_, i) => `$${i + 1}`);
      const updatable = columns.filter((spec) => spec.col !== 'id' && spec.col !== 'created_at');

      const res = await query<Row>(
        `INSERT INTO ${table} (${columns.map((c) => c.col).join(', ')})
         VALUES (${placeholders.join(', ')})
         ON CONFLICT (id) DO UPDATE SET
           ${updatable.map((c) => `${c.col} = EXCLUDED.${c.col}`).join(', ')}
         RETURNING *`,
        values,
      );
      return res.rows[0] ? rowToApp(res.rows[0]) : null;
    },

    /** Update only the fields present on the patch. */
    async updateById(id: string, patch: AppObject) {
      const targets = columns.filter(
        (spec) => spec.col !== 'id' && patch[spec.field] !== undefined,
      );
      if (touchUpdatedAt) {
        patch = { ...patch, updatedAt: new Date().toISOString() };
        if (!targets.some((c) => c.col === 'updated_at')) {
          const spec = columns.find((c) => c.col === 'updated_at');
          if (spec) targets.push(spec);
        }
      }
      if (targets.length === 0) {
        const existing = await query<Row>(`SELECT * FROM ${table} WHERE id = $1`, [id]);
        return existing.rows[0] ? rowToApp(existing.rows[0]) : null;
      }

      const sets = targets.map((spec, i) => `${spec.col} = $${i + 1}`);
      const values = targets.map((spec) => toColumnValue(spec, patch));
      values.push(id);

      const res = await query<Row>(
        `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values,
      );
      return res.rows[0] ? rowToApp(res.rows[0]) : null;
    },

    async deleteById(id: string) {
      await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    },

    async bulkUpsert(records: AppObject[]) {
      const results = [];
      for (const record of records) {
        results.push(await this.upsert(record));
      }
      return results.filter(Boolean);
    },
  };
}
