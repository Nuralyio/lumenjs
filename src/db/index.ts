import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { getProjectDir } from './context.js';
// DB path read inline to avoid pulling server-only config.js into client bundle
import { autoMigrate } from './auto-migrate.js';
import { getRegisteredTables } from './table.js';
import { autoSeed, waitForSeed } from './seed.js';

export { defineTable, getRegisteredTables } from './table.js';
export type { TableDefinition, TableColumn } from './table.js';
export { waitForSeed } from './seed.js';

export class LumenDb {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** SELECT multiple rows */
  all<T = any>(sql: string, ...params: any[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  /** SELECT single row */
  get<T = any>(sql: string, ...params: any[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  /** INSERT/UPDATE/DELETE */
  run(sql: string, ...params: any[]): { changes: number; lastInsertRowid: number | bigint } {
    const result = this.db.prepare(sql).run(...params);
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }

  /** Multi-statement DDL */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** Access the underlying better-sqlite3 instance */
  get raw(): Database.Database {
    return this.db;
  }
}

let _instance: LumenDb | null = null;

export function useDb(): LumenDb {
  if (_instance) return _instance;

  const projectDir = getProjectDir();
  // Read db path directly from config file (lightweight, no fileURLToPath dependency)
  const dbRelPath = (() => {
    try {
      const c = fs.readFileSync(path.join(projectDir, 'lumenjs.config.ts'), 'utf-8');
      const m = c.match(/db\s*:\s*\{[^}]*path\s*:\s*['"]([^'"]+)['"]/);
      return m ? m[1] : 'data/db.sqlite';
    } catch { return 'data/db.sqlite'; }
  })();
  const dbPath = path.resolve(projectDir, dbRelPath);

  // Auto-create directory
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  _instance = new LumenDb(db);

  // Auto-generate migrations from defineTable() definitions
  autoMigrate(db, projectDir, getRegisteredTables());

  // Run pending migrations
  runMigrations(db, projectDir);

  // Auto-seed on first creation
  autoSeed(db, projectDir);

  return _instance;
}

function runMigrations(db: Database.Database, projectDir: string): void {
  const migrationsDir = path.join(projectDir, 'data', 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  // Ensure tracking table exists
  db.exec(`CREATE TABLE IF NOT EXISTS _lumen_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = new Set(
    db.prepare('SELECT name FROM _lumen_migrations').all()
      .map((row: any) => row.name)
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
