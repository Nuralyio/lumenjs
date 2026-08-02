/**
 * The database surface auth code is allowed to assume. Structural: LumenDb
 * satisfies it, as does any hand-rolled object a host app passes to
 * handleAuthRoutes. `isPg` is optional; undefined is read as Postgres, which
 * keeps emitted DDL byte-identical to what existing deployments already ran.
 */
export interface AuthDb {
  all<T = any>(sql: string, ...params: any[]): Promise<T[]>;
  get<T = any>(sql: string, ...params: any[]): Promise<T | undefined>;
  run(sql: string, ...params: any[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
  exec(sql: string): Promise<void>;
  readonly isPg?: boolean;
}

/**
 * SQL for "now" as a column DEFAULT, per dialect. `DEFAULT NOW()` is a syntax
 * error on SQLite — a DEFAULT expression there must be parenthesised.
 */
export function nowDefault(db: AuthDb): string {
  return db.isPg === false ? "(datetime('now'))" : 'NOW()';
}

/** SQL for an auto-incrementing integer primary key, per dialect. */
export function autoIncrementPk(db: AuthDb): string {
  return db.isPg === false ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'SERIAL PRIMARY KEY';
}
