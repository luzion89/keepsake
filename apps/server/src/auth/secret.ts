/**
 * Manages the persistent root_secret for this server instance.
 * On first run: generates 32 random bytes, stores in SQLite auth_config.
 * On subsequent runs: loads from SQLite.
 */
import { randomBytes, createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export function ensureRootSecret(db: Database.Database): string {
  const row = db.prepare("SELECT value FROM auth_config WHERE key = 'root_secret'").get() as { value: string } | undefined;
  if (row) return row.value;

  const secret = randomBytes(32).toString('hex');
  db.prepare("INSERT INTO auth_config (key, value) VALUES ('root_secret', ?)").run(secret);
  return secret;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
