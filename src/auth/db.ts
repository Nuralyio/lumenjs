/**
 * The database surface auth code is allowed to assume.
 *
 * This interface used to be declared twice, privately and verbatim, in
 * native-auth.ts and token.ts. It is structural on purpose: LumenDb satisfies
 * it, and so does any hand-rolled object a host app passes to
 * handleAuthRoutes — the Joule console does exactly that.
 *
 * `isPg` is optional because those hand-rolled objects may not carry it.
 * Undefined is read as Postgres, which keeps the emitted DDL byte-identical
 * to what every existing deployment has already run — a default that changed
 * the DDL under a live app would be a migration nobody asked for.
 */
export interface AuthDb {
  all<T = any>(sql: string, ...params: any[]): Promise<T[]>;
  get<T = any>(sql: string, ...params: any[]): Promise<T | undefined>;
  run(sql: string, ...params: any[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
  exec(sql: string): Promise<void>;
  readonly isPg?: boolean;
}

/**
 * SQL for "now" as a column DEFAULT, per dialect.
 *
 * The reason this exists: ensureUsersTable used to write `DEFAULT NOW()`,
 * which is a syntax error on SQLite — a DEFAULT expression there must be
 * parenthesised — so every SQLite host either failed on first signup or
 * carried a translating proxy around the framework (the Joule console's
 * sqliteDialect). The dialect decision belongs here, once.
 */
export function nowDefault(db: AuthDb): string {
  return db.isPg === false ? "(datetime('now'))" : 'NOW()';
}

/** SQL for an auto-incrementing integer primary key, per dialect. */
export function autoIncrementPk(db: AuthDb): string {
  return db.isPg === false ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'SERIAL PRIMARY KEY';
}
