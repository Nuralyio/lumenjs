import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { AsyncLocalStorage } from 'async_hooks';
import Database from 'better-sqlite3';

const _require = createRequire(import.meta.url);
import { getProjectDir } from './context.js';
import { autoMigrate } from './auto-migrate.js';
import { getRegisteredTables } from './table.js';
import { autoSeed, waitForSeed } from './seed.js';

export { defineTable, getRegisteredTables } from './table.js';
export type { TableDefinition, TableColumn } from './table.js';
export { waitForSeed } from './seed.js';

// ── Abstract async interface ───────────────────────────────────────────────

export abstract class LumenDb {
  abstract all<T = any>(sql: string, ...params: any[]): Promise<T[]>;
  abstract get<T = any>(sql: string, ...params: any[]): Promise<T | undefined>;
  abstract run(sql: string, ...params: any[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
  abstract exec(sql: string): Promise<void>;
  abstract withTransaction<T>(fn: () => Promise<T>): Promise<T>;
  readonly isPg: boolean = false;
  /** Raw SQLite Database — only available in SQLite mode */
  get raw(): Database.Database {
    throw new Error('raw is only available in SQLite mode');
  }
}

// ── SQLite implementation ─────────────────────────────────────────────────

class LumenDbSqlite extends LumenDb {
  readonly isPg = false;

  constructor(private db: Database.Database) {
    super();
  }

  async all<T>(sql: string, ...params: any[]): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async get<T>(sql: string, ...params: any[]): Promise<T | undefined> {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  async run(sql: string, ...params: any[]): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const stmt = this.db.prepare(sql);
    // RETURNING clause → use .get() to capture the returned row's id
    if (/\bRETURNING\b/i.test(sql)) {
      const row = stmt.get(...params) as any;
      return { changes: 1, lastInsertRowid: row?.id ?? 0 };
    }
    const result = stmt.run(...params);
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    this.db.exec('BEGIN');
    try {
      const result = await fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw e;
    }
  }

  get raw(): Database.Database {
    return this.db;
  }
}

// ── PostgreSQL implementation ─────────────────────────────────────────────

// AsyncLocalStorage stores the current transactional pg client so queries
// within withTransaction() use the same connection.
const pgTxClient = new AsyncLocalStorage<any>();

class LumenDbPg extends LumenDb {
  readonly isPg = true;
  private pool: any;

  constructor(connectionString: string) {
    super();
    // Use createRequire for CJS compatibility in ESM context
    const { Pool } = _require('pg');
    this.pool = new Pool({ connectionString });
    this.pool.on('error', (err: any) => {
      console.error('[LumenJS PG] Pool error:', err.message);
    });
  }

  /** Convert SQLite-flavoured SQL to PostgreSQL */
  private convertSql(sql: string): string {
    // INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
    const isInsertOrIgnore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql);
    let result = isInsertOrIgnore
      ? sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO')
      : sql;

    // Replace ? with $1, $2, ... positional parameters
    let i = 0;
    result = result.replace(/\?/g, () => `$${++i}`);

    // datetime('now', '+N unit') / datetime('now', '-N unit')
    result = result.replace(
      /datetime\s*\(\s*'now'\s*,\s*'([+-]\d+)\s+(\w+)'\s*\)/gi,
      (_m, offset: string, unit: string) => {
        const op = offset.startsWith('-') ? '-' : '+';
        const amount = offset.replace(/^[+-]/, '');
        return `NOW() ${op} INTERVAL '${amount} ${unit}'`;
      },
    );
    // datetime('now')
    result = result.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'NOW()');

    // json_each(expr) alias → jsonb_array_elements_text(expr::jsonb) AS alias
    result = result.replace(
      /\bjson_each\s*\(([^)]+)\)\s+(\w+)/gi,
      (_m, expr: string, alias: string) => `jsonb_array_elements_text(${expr.trim()}::jsonb) AS ${alias}`,
    );
    // alias.value (from json_each) → alias (jsonb_array_elements_text column is the alias itself)
    result = result.replace(/\b(\w+)\.value\b/g, '$1');

    if (isInsertOrIgnore) {
      result = result.trimEnd() + ' ON CONFLICT DO NOTHING';
    }

    return result;
  }

  private getClient(): any {
    // Return transactional client if inside withTransaction, otherwise use pool
    return pgTxClient.getStore() ?? this.pool;
  }

  async all<T>(sql: string, ...params: any[]): Promise<T[]> {
    const pgSql = this.convertSql(sql);
    const res = await this.getClient().query(pgSql, params);
    return res.rows as T[];
  }

  async get<T>(sql: string, ...params: any[]): Promise<T | undefined> {
    const pgSql = this.convertSql(sql);
    const res = await this.getClient().query(pgSql, params);
    return res.rows[0] as T | undefined;
  }

  async run(sql: string, ...params: any[]): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const pgSql = this.convertSql(sql);
    const res = await this.getClient().query(pgSql, params);
    const lastInsertRowid: number | bigint = res.rows?.[0]?.id ?? 0;
    return { changes: res.rowCount ?? 0, lastInsertRowid };
  }

  async exec(sql: string): Promise<void> {
    // exec is used for DDL / multi-statement — skip placeholder conversion
    // (DDL has no ? params), just normalize datetime() calls
    const pgSql = this.convertSql(sql);
    await this.getClient().query(pgSql);
  }

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // All db calls inside fn() will use this client via AsyncLocalStorage
      const result = await pgTxClient.run(client, fn);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }
}

// ── Singleton management ──────────────────────────────────────────────────

let _instance: LumenDb | null = null;
let _migrationPromise: Promise<void> | null = null;

export function useDb(): LumenDb {
  if (_instance) return _instance;

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && (databaseUrl.startsWith('postgres') || databaseUrl.startsWith('postgresql'))) {
    _instance = new LumenDbPg(databaseUrl);
    const projectDir = (() => {
      try { return getProjectDir(); } catch { return process.env.LUMENJS_PROJECT_DIR || process.cwd(); }
    })();
    _migrationPromise = runPgMigrations(_instance as LumenDbPg, projectDir);
    _migrationPromise.catch(err =>
      console.error('[LumenJS] PG migration error:', err.message),
    );
    return _instance;
  }

  // SQLite mode
  const projectDir = getProjectDir();
  const dbRelPath = (() => {
    try {
      const c = fs.readFileSync(path.join(projectDir, 'lumenjs.config.ts'), 'utf-8');
      const m = c.match(/db\s*:\s*\{[^}]*path\s*:\s*['"]([^'"]+)['"]/);
      return m ? m[1] : 'data/db.sqlite';
    } catch { return 'data/db.sqlite'; }
  })();
  const dbPath = path.resolve(projectDir, dbRelPath);

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const rawDb = new Database(dbPath);
  rawDb.pragma('journal_mode = WAL');
  rawDb.pragma('foreign_keys = ON');

  _instance = new LumenDbSqlite(rawDb);

  autoMigrate(rawDb, projectDir, getRegisteredTables());
  runSqliteMigrations(rawDb, projectDir);
  autoSeed(rawDb, projectDir);

  return _instance;
}

/**
 * Returns a promise that resolves when the initial DB migrations have completed.
 * Useful for waiting before serving the first request in PG mode.
 */
export function waitForMigrations(): Promise<void> {
  return _migrationPromise ?? Promise.resolve();
}

// ── SQLite migration runner ───────────────────────────────────────────────

function runSqliteMigrations(db: Database.Database, projectDir: string): void {
  const migrationsDir = path.join(projectDir, 'data', 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  db.exec(`CREATE TABLE IF NOT EXISTS _lumen_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = new Set(
    db.prepare('SELECT name FROM _lumen_migrations').all().map((r: any) => r.name),
  );

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const migrate = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _lumen_migrations (name) VALUES (?)').run(file);
    });
    migrate();
    console.log(`[LumenJS] Applied migration: ${file}`);
  }
}

// ── PostgreSQL migration runner ───────────────────────────────────────────

async function runPgMigrations(db: LumenDbPg, projectDir: string): Promise<void> {
  const migrationsDir = path.join(projectDir, 'data', 'migrations', 'postgres');
  if (!fs.existsSync(migrationsDir)) return;

  await db.exec(`CREATE TABLE IF NOT EXISTS _lumen_migrations (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);

  const applied = new Set(
    (await db.all<{ name: string }>('SELECT name FROM _lumen_migrations')).map(r => r.name),
  );

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await db.exec(sql);
    await db.run('INSERT INTO _lumen_migrations (name) VALUES (?)', file);
    console.log(`[LumenJS] Applied PG migration: ${file}`);
  }
}

