/**
 * An in-memory SQLite database implementing AuthDb, for tests.
 *
 * The first db harness in this package, and deliberately tiny: the auth code
 * depends only on the four-method AuthDb surface, so a test database is
 * better-sqlite3 behind exactly those four methods. It became possible when
 * the DDL stopped being Postgres-only (db.ts's nowDefault/autoIncrementPk);
 * before that, ensureUsersTable was a syntax error on SQLite and every
 * db-touching function in this module was untested.
 *
 * Named test-db.ts, not *.test.ts, so vitest's include glob does not treat
 * the harness itself as a suite.
 */
import Database from 'better-sqlite3';
import type { AuthDb } from './db.js';

export function createTestDb(): AuthDb & { close(): void } {
  const raw = new Database(':memory:');
  return {
    isPg: false,
    async all<T = any>(sql: string, ...params: any[]): Promise<T[]> {
      return raw.prepare(sql).all(...params) as T[];
    },
    async get<T = any>(sql: string, ...params: any[]): Promise<T | undefined> {
      return raw.prepare(sql).get(...params) as T | undefined;
    },
    async run(sql: string, ...params: any[]) {
      const info = raw.prepare(sql).run(...params);
      return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
    },
    async exec(sql: string) {
      raw.exec(sql);
    },
    close() {
      raw.close();
    },
  };
}
