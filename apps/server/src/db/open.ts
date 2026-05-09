import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DbHandle {
  db: Database.Database;
  close: () => void;
}

/**
 * Ensure the items table has the notes and expires_at columns.
 * Uses PRAGMA table_info to check, then ALTER TABLE ADD COLUMN if missing.
 * Safe to run on both new and legacy databases.
 */
function ensureItemsColumns(db: Database.Database): void {
  const cols = (db.prepare('PRAGMA table_info(items)').all() as Array<{ name: string }>)
    .map(c => c.name);

  if (!cols.includes('notes')) {
    try {
      db.exec('ALTER TABLE items ADD COLUMN notes TEXT');
    } catch (e) {
      // Column may have been added concurrently; ignore duplicate-column errors.
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('duplicate column')) throw e;
    }
  }

  if (!cols.includes('enc_blob')) {
    try {
      db.exec('ALTER TABLE items ADD COLUMN enc_blob TEXT');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('duplicate column')) throw e;
    }
  }

  if (!cols.includes('expires_at')) {
    try {
      db.exec('ALTER TABLE items ADD COLUMN expires_at INTEGER');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('duplicate column')) throw e;
    }
  }
}

export function openDb(path = process.env.KEEPSAKE_DB ?? './data/keepsake.sqlite'): DbHandle {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = readFileSync(resolve(__dirname, './schema.sql'), 'utf-8');
  db.exec(schema);
  // Runtime migration: ensure notes / expires_at columns exist on legacy databases
  // (CREATE TABLE IF NOT EXISTS won't add columns to pre-existing tables).
  ensureItemsColumns(db);
  return { db, close: () => db.close() };
}
