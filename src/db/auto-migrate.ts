import path from 'path';
import fs from 'fs';
import type Database from 'better-sqlite3';
import type { TableDefinition } from './table.js';

interface PragmaColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function parseBaseType(typeStr: string): string {
  // Extract just the base type (first word), lowercased
  return typeStr.trim().split(/\s+/)[0].toLowerCase();
}

function buildCreateTableSQL(table: TableDefinition): string {
  const cols = table.columns
    .map(c => `  ${c.name} ${c.type}`)
    .join(',\n');
  return `CREATE TABLE ${table.name} (\n${cols}\n);`;
}

function buildAddColumnSQL(tableName: string, colName: string, colType: string): string {
  return `ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colType};`;
}

function generateTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function autoMigrate(
  db: Database.Database,
  projectDir: string,
  tables: Map<string, TableDefinition>,
): void {
  if (process.env.NODE_ENV === 'production') return;
  if (tables.size === 0) return;

  const migrationsDir = path.join(projectDir, 'data', 'migrations');

  for (const [tableName, definition] of tables) {
    const existingColumns = getExistingColumns(db, tableName);

    if (!existingColumns) {
      // Table doesn't exist — generate CREATE TABLE
      const sql = buildCreateTableSQL(definition);
      writeMigrationFile(migrationsDir, `auto_${tableName}_create`, sql);
      continue;
    }

    // Table exists — diff columns
    const existingColNames = new Set(existingColumns.map(c => c.name.toLowerCase()));
    const definedColNames = new Set(definition.columns.map(c => c.name.toLowerCase()));

    // Find new columns to add
    const addStatements: string[] = [];
    for (const col of definition.columns) {
      if (!existingColNames.has(col.name.toLowerCase())) {
        addStatements.push(buildAddColumnSQL(tableName, col.name, col.type));
      }
    }

    if (addStatements.length > 0) {
      const colNames = definition.columns
        .filter(c => !existingColNames.has(c.name.toLowerCase()))
        .map(c => c.name);
      const suffix = colNames.length === 1
        ? `add_${colNames[0]}`
        : `add_${colNames.length}_columns`;
      writeMigrationFile(migrationsDir, `auto_${tableName}_${suffix}`, addStatements.join('\n'));
    }

    // Warn about columns in DB but not in definition (potential drops)
    for (const existing of existingColumns) {
      if (!definedColNames.has(existing.name.toLowerCase())) {
        console.warn(
          `[LumenJS] Column "${existing.name}" exists in table "${tableName}" but is not in defineTable(). ` +
          `SQLite does not support DROP COLUMN in older versions — create a manual migration if needed.`,
        );
      }
    }

    // Warn about type mismatches
    const existingByName = new Map(existingColumns.map(c => [c.name.toLowerCase(), c]));
    for (const col of definition.columns) {
      const existing = existingByName.get(col.name.toLowerCase());
      if (existing) {
        const definedBase = parseBaseType(col.type);
        const existingBase = parseBaseType(existing.type);
        if (definedBase !== existingBase) {
          console.warn(
            `[LumenJS] Column "${col.name}" in table "${tableName}" has type "${existing.type}" in DB ` +
            `but "${col.type}" in defineTable(). SQLite does not support ALTER COLUMN — create a manual migration if needed.`,
          );
        }
      }
    }
  }
}

function getExistingColumns(db: Database.Database, tableName: string): PragmaColumnInfo[] | null {
  try {
    const columns = db.pragma(`table_info(${tableName})`) as PragmaColumnInfo[];
    if (columns.length === 0) return null;
    return columns;
  } catch {
    return null;
  }
}

function writeMigrationFile(migrationsDir: string, label: string, sql: string): void {
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  const timestamp = generateTimestamp();
  const filename = `${timestamp}_${label}.sql`;
  const filePath = path.join(migrationsDir, filename);

  // Avoid duplicate generation if file with same label already exists (not yet applied)
  const existing = fs.readdirSync(migrationsDir).filter(f => f.endsWith(`_${label}.sql`));
  if (existing.length > 0) return;

  fs.writeFileSync(filePath, sql + '\n', 'utf-8');
  console.log(`[LumenJS] Generated migration: ${filename}`);
}
