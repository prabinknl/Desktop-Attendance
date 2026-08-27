import pg from 'pg';
import dns from 'node:dns';
import { env } from '../config/env.js';

const { Pool } = pg;

// Prefer IPv4 — Windows IPv6 routes to cloud Postgres often RST mid-handshake.
dns.setDefaultResultOrder('ipv4first');

// Return DATE columns as the literal 'YYYY-MM-DD' string. The default parser
// builds a Date at local midnight, and formatting that back through UTC shifts
// the calendar day for any timezone east of UTC.
const PG_TYPE_DATE = 1082;
pg.types.setTypeParser(PG_TYPE_DATE, (value: string) => value);

function parseDatabaseUrl(connectionString: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} | null {
  try {
    const url = new URL(connectionString);
    const database = decodeURIComponent(url.pathname.replace(/^\//, '') || 'postgres');
    return {
      host: url.hostname,
      port: Number(url.port || 5432),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
    };
  } catch {
    return null;
  }
}

const isLocalDb = /localhost|127\.0\.0\.1/.test(env.databaseUrl);
const parsed = parseDatabaseUrl(env.databaseUrl);

export const pool = new Pool({
  // Explicit fields avoid pg-connection-string mapping sslmode=require to
  // verify-full, which InsForge terminates mid-handshake.
  ...(parsed ? parsed : { connectionString: env.databaseUrl }),
  connectionTimeoutMillis: 8_000,
  idleTimeoutMillis: 10_000,
  max: 5,
  keepAlive: true,
  ...(isLocalDb
    ? {}
    : {
        ssl: { rejectUnauthorized: false },
        // InsForge terminates STARTTLS SSLRequest; speak TLS immediately.
        sslnegotiation: 'direct',
      }),
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
