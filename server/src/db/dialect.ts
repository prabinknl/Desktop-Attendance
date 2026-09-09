/**
 * Database dialect detection for Hostinger MySQL/MariaDB vs legacy Postgres/InsForge.
 * Prefer DB_* (MySQL). Fall back to DATABASE_URL postgres for migration safety.
 */

export type DbDriver = 'mysql' | 'postgres';

function hasMysqlDiscreteConfig(): boolean {
  return Boolean(
    (process.env.DB_HOST ?? '').trim() &&
      (process.env.DB_NAME ?? '').trim() &&
      (process.env.DB_USER ?? '').trim(),
  );
}

function parseDriverOverride(): DbDriver | null {
  const raw = (process.env.DB_DRIVER ?? '').trim().toLowerCase();
  if (raw === 'mysql' || raw === 'mariadb') return 'mysql';
  if (raw === 'postgres' || raw === 'postgresql' || raw === 'pg') return 'postgres';
  return null;
}

export function resolveDbDriver(): DbDriver {
  const override = parseDriverOverride();
  if (override) return override;

  if (hasMysqlDiscreteConfig()) return 'mysql';

  const url = (process.env.DATABASE_URL ?? '').trim();
  if (/^mysql(\+[^:]*)?:\/\//i.test(url) || /^mariadb:\/\//i.test(url)) return 'mysql';
  if (/^postgres(ql)?:\/\//i.test(url)) return 'postgres';

  // Hostinger default when only partial DB_* is present still prefers postgres
  // until DB_HOST+DB_NAME+DB_USER are complete (see hasMysqlDiscreteConfig).
  return 'postgres';
}

export const dbDriver: DbDriver = resolveDbDriver();

export function isMysql(): boolean {
  return dbDriver === 'mysql';
}

export function isPostgres(): boolean {
  return dbDriver === 'postgres';
}

/** Positional placeholder for the active dialect ($1 vs ?). */
export function ph(index: number): string {
  return isMysql() ? '?' : `$${index}`;
}

/** Convert Postgres-style $1..$n placeholders to MySQL ?, expanding reused indexes. */
export function toMysqlPlaceholders(
  sql: string,
  params: unknown[] = [],
): { sql: string; params: unknown[] } {
  // Some callers (e.g. crudFactory) build SQL with ph(), which already emits
  // literal '?' for MySQL. Only rewrite when $N placeholders are actually
  // present — otherwise this would zero out params for already-correct SQL.
  if (!/\$\d+/.test(sql)) {
    return { sql, params };
  }
  const expanded: unknown[] = [];
  const converted = sql.replace(/\$(\d+)/g, (_match, n: string) => {
    const idx = Number(n) - 1;
    expanded.push(params[idx]);
    return '?';
  });
  return { sql: converted, params: expanded };
}
