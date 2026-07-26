import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

// Return DATE columns as the literal 'YYYY-MM-DD' string. The default parser
// builds a Date at local midnight, and formatting that back through UTC shifts
// the calendar day for any timezone east of UTC.
const PG_TYPE_DATE = 1082;
pg.types.setTypeParser(PG_TYPE_DATE, (value: string) => value);

export const pool = new Pool({
  connectionString: env.databaseUrl,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}
