import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import type { LumenDb } from './index.js';

const SEED_TABLE = '_lumen_seed_applied';
const SEED_NAME = 'data/seed.ts';

function ensureSeedTableSqlite(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${SEED_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

function isSeedAppliedSqlite(db: Database.Database): boolean {
  ensureSeedTableSqlite(db);
  const row = db.prepare(`SELECT 1 FROM ${SEED_TABLE} WHERE name = ?`).get(SEED_NAME);
  return !!row;
}

function markSeedAppliedSqlite(db: Database.Database): void {
  db.prepare(`INSERT OR IGNORE INTO ${SEED_TABLE} (name) VALUES (?)`).run(SEED_NAME);
}

async function loadAndRunSeed(projectDir: string): Promise<void> {
  const seedPath = path.join(projectDir, 'data', 'seed.ts');
  const mod = await import(/* @vite-ignore */ seedPath);
  const seedFn = mod.default || mod;
  if (typeof seedFn === 'function') {
    await seedFn();
  }
}

let _seedPromise: Promise<void> | null = null;

/**
 * Auto-seed on first DB creation. Called from useDb() after migrations.
 * Only runs in SQLite mode (PG seeds are handled separately).
 */
export function autoSeed(db: Database.Database, projectDir: string): void {
  if (isSeedAppliedSqlite(db)) return;

  const seedPath = path.join(projectDir, 'data', 'seed.ts');
  if (!fs.existsSync(seedPath)) return;

  console.log('[LumenJS] Running seed file...');
  markSeedAppliedSqlite(db);

  _seedPromise = loadAndRunSeed(projectDir)
    .then(() => {
      console.log('[LumenJS] Seed applied.');
    })
    .catch(err => {
      console.error('[LumenJS] Failed to run seed:', err);
      db.prepare(`DELETE FROM ${SEED_TABLE} WHERE name = ?`).run(SEED_NAME);
    })
    .finally(() => {
      _seedPromise = null;
    });
}

/**
 * Returns a promise that resolves when any in-progress seed completes.
 */
export function waitForSeed(): Promise<void> {
  return _seedPromise ?? Promise.resolve();
}

/** Run seed via CLI. If force=true, re-run even if already applied. */
export async function runSeed(projectDir: string, force: boolean = false): Promise<void> {
  const seedPath = path.join(projectDir, 'data', 'seed.ts');
  if (!fs.existsSync(seedPath)) {
    console.error(`[LumenJS] Seed file not found: ${seedPath}`);
    process.exit(1);
  }

  const { useDb } = await import('./index.js');
  const lumenDb = useDb();

  // PG mode: seeds are not tracked via SQLite mechanism
  if (lumenDb.isPg) {
    if (!force) {
      console.log('[LumenJS] PG mode: skipping seed tracking check. Use --force to run anyway.');
      return;
    }
    await loadAndRunSeed(projectDir);
    console.log('[LumenJS] Seed applied.');
    return;
  }

  const db = lumenDb.raw;
  ensureSeedTableSqlite(db);

  if (!force && isSeedAppliedSqlite(db)) {
    console.log('[LumenJS] Seed already applied. Use --force to re-run.');
    return;
  }

  console.log('[LumenJS] Running seed file...');
  await loadAndRunSeed(projectDir);
  markSeedAppliedSqlite(db);
  console.log('[LumenJS] Seed applied.');
}
