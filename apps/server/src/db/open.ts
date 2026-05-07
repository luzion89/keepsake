import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DbHandle {
  db: Database.Database;
  close: () => void;
}

export function openDb(path = process.env.KEEPSAKE_DB ?? './data/keepsake.sqlite'): DbHandle {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = readFileSync(resolve(__dirname, './schema.sql'), 'utf-8');
  db.exec(schema);
  return { db, close: () => db.close() };
}
