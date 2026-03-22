import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

const SEED_TABLE = '_lumen_seed_applied';
const SEED_NAME = 'data/seed.ts';

function ensureSeedTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${SEED_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

function isSeedApplied(db: Database.Database): boolean {
  ensureSeedTable(db);
  const row = db.prepare(`SELECT 1 FROM ${SEED_TABLE} WHERE name = ?`).get(SEED_NAME);
  return !!row;
}

function markSeedApplied(db: Database.Database): void {
  db.prepare(`INSERT OR IGNORE INTO ${SEED_TABLE} (name) VALUES (?)`).run(SEED_NAME);
}

async function loadAndRunSeed(projectDir: string): Promise<void> {
  const seedPath = path.join(projectDir, 'data', 'seed.ts');
  const mod = await import(seedPath);
  const seedFn = mod.default || mod;
  if (typeof seedFn === 'function') {
    await seedFn();
  }
}

/**
 * Auto-seed on first DB creation. Called from useDb() after migrations.
 * Fires asynchronously — the import() of the seed file is async,
 * but the seed function itself typically uses sync better-sqlite3 ops.
 */
export function autoSeed(db: Database.Database, projectDir: string): void {
  if (isSeedApplied(db)) return;

  const seedPath = path.join(projectDir, 'data', 'seed.ts');
  if (!fs.existsSync(seedPath)) return;

  console.log('[LumenJS] Running seed file...');
  loadAndRunSeed(projectDir)
    .then(() => {
      markSeedApplied(db);
      console.log('[LumenJS] Seed applied.');
    })
    .catch(err => {
      console.error('[LumenJS] Failed to run seed:', err);
    });
}

/** Run seed via CLI. If force=true, re-run even if already applied. */
export async function runSeed(projectDir: string, force: boolean = false): Promise<void> {
  const seedPath = path.join(projectDir, 'data', 'seed.ts');
  if (!fs.existsSync(seedPath)) {
    console.error(`[LumenJS] Seed file not found: ${seedPath}`);
    process.exit(1);
  }

  // Import useDb to initialize the database (runs migrations first)
  const { useDb } = await import('./index.js');
  const lumenDb = useDb();
  const db = lumenDb.raw;

  ensureSeedTable(db);

  if (!force && isSeedApplied(db)) {
    console.log('[LumenJS] Seed already applied. Use --force to re-run.');
    return;
  }

  console.log('[LumenJS] Running seed file...');
  await loadAndRunSeed(projectDir);
  markSeedApplied(db);
  console.log('[LumenJS] Seed applied.');
}
