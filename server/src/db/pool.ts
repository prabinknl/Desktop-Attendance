import dns from 'node:dns';
import pg from 'pg';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { dbDriver, isMysql, toMysqlPlaceholders } from './dialect.js';

const { Pool: PgPool } = pg;

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

function parseMysqlUrl(connectionString: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} | null {
  try {
    const url = new URL(connectionString);
    const database = decodeURIComponent(url.pathname.replace(/^\//, '') || '');
    return {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
    };
  } catch {
    return null;
  }
}

function createMysqlPool() {
  const fromUrl =
    env.databaseUrl && /^(mysql(\+[^:]*)?|mariadb):\/\//i.test(env.databaseUrl)
      ? parseMysqlUrl(env.databaseUrl)
      : null;

  const host = env.dbHost || fromUrl?.host || '127.0.0.1';
  const port = env.dbPort || fromUrl?.port || 3306;
  const user = env.dbUser || fromUrl?.user || 'root';
  const password = env.dbPassword || fromUrl?.password || '';
  const database = env.dbName || fromUrl?.database || '';

  return mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true,
  });
}

function createPostgresPool() {
  const isLocalDb = /localhost|127\.0\.0\.1/.test(env.databaseUrl);
  const parsed = parseDatabaseUrl(env.databaseUrl);

  const pool = new PgPool({
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

  return pool;
}

export const pool = isMysql() ? createMysqlPool() : createPostgresPool();

export function getPoolDriver(): 'mysql' | 'postgres' {
  return dbDriver;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number }> {
  if (isMysql()) {
    const converted = toMysqlPlaceholders(text, params ?? []);
    const [result] = await (pool as mysql.Pool).execute(
      converted.sql,
      converted.params as (string | number | boolean | Date | null | Buffer)[],
    );
    if (Array.isArray(result)) {
      const rows = result as T[];
      return { rows, rowCount: rows.length };
    }
    const header = result as mysql.ResultSetHeader;
    return { rows: [] as T[], rowCount: header.affectedRows ?? 0 };
  }

  const res = await (pool as pg.Pool).query(text, params);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch (err) {
    console.warn(
      '[DB] Connection check failed:',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
