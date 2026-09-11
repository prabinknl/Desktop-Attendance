import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, query } from './pool.js';
import { isMysql } from './dialect.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveMysqlSchemaPath(): string | null {
  const candidates = [
    // Packaged Electron: resources/server/database/hostinger-mysql-schema.sql
    // (__dirname is resources/server/dist/db at runtime).
    path.resolve(__dirname, '../../database/hostinger-mysql-schema.sql'),
    path.resolve(__dirname, '../../../database/hostinger-mysql-schema.sql'),
    path.resolve(__dirname, '../../../../database/hostinger-mysql-schema.sql'),
    path.resolve(process.cwd(), 'database/hostinger-mysql-schema.sql'),
    path.resolve(process.cwd(), '../database/hostinger-mysql-schema.sql'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Split SQL on semicolons while skipping empty / comment-only chunks. */
function splitSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false;
      const withoutComments = part
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('--'))
        .join('\n')
        .trim();
      return Boolean(withoutComments);
    });
}

async function runMysqlSchema(): Promise<void> {
  const schemaPath = resolveMysqlSchemaPath();
  if (!schemaPath) {
    throw new Error(
      'MySQL schema file not found (database/hostinger-mysql-schema.sql). Checked repo-relative candidates.',
    );
  }

  const sql = fs.readFileSync(schemaPath, 'utf-8');
  const statements = splitSqlStatements(sql);
  for (const statement of statements) {
    await query(statement);
  }
  console.log(`[DB] Applied MySQL schema: ${path.basename(schemaPath)} (${statements.length} statements)`);
}

async function runPostgresMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await (pool as { query: (sql: string) => Promise<unknown> }).query(sql);
    console.log(`[DB] Applied migration: ${file}`);
  }
}

export async function runMigrations(): Promise<void> {
  if (isMysql()) {
    await runMysqlSchema();
    return;
  }
  await runPostgresMigrations();
}
