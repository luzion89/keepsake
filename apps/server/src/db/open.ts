import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DbHandle {
  db: Database.Database;
  close: () => void;
}

/**
 * Drop and recreate the database if the schema is outdated (spike: family_id era).
 * This is acceptable because spike branch data is not production data.
 */
function needsRebuild(db: Database.Database): boolean {
  try {
    const cols = (db.prepare('PRAGMA table_info(devices)').all() as Array<{ name: string }>)
      .map(c => c.name);
    return !cols.includes('family_id');
  } catch {
    return true;
  }
}

export function openDb(path = process.env.KEEPSAKE_DB ?? './data/keepsake.sqlite'): DbHandle {
  const absPath = resolve(path);
  mkdirSync(dirname(absPath), { recursive: true });

  // Check if existing DB needs rebuild (pre-family_id schema)
  if (existsSync(absPath)) {
    const probe = new Database(absPath);
    const rebuild = needsRebuild(probe);
    probe.close();
    if (rebuild) {
      console.warn('[db] Detected pre-family_id schema — dropping and rebuilding (spike data is ephemeral)');
      unlinkSync(absPath);
      // Also remove WAL/SHM files if present
      for (const ext of ['-wal', '-shm']) {
        const f = absPath + ext;
        if (existsSync(f)) unlinkSync(f);
      }
    }
  }

  const db = new Database(absPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = readFileSync(resolve(__dirname, './schema.sql'), 'utf-8');
  db.exec(schema);
  return { db, close: () => db.close() };
}
