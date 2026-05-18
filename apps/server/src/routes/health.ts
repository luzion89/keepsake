import type { FastifyPluginAsync } from 'fastify';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { listBackups } from '../backup.js';

const VERSION = '0.1.0';

/** Cache FS stats for 10 seconds to avoid per-request disk access. */
interface CachedStats {
  dbSizeBytes: number | null;
  lastBackupAt: number | null;
  backupCount: number;
  cachedAt: number;
}
let statsCache: CachedStats | null = null;
const CACHE_TTL_MS = 10_000;

function getFsStats(): Omit<CachedStats, 'cachedAt'> {
  const now = Date.now();
  if (statsCache && now - statsCache.cachedAt < CACHE_TTL_MS) {
    const { cachedAt: _, ...rest } = statsCache;
    return rest;
  }

  const dbPath = resolve(process.env.KEEPSAKE_DB ?? './data/keepsake.sqlite');
  let dbSizeBytes: number | null = null;
  try {
    dbSizeBytes = statSync(dbPath).size;
  } catch (e) {
    // ENOENT is expected on first boot before any data is written; other errors are unexpected.
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') fastify_log_warn(`[health] unexpected stat error for ${dbPath}: ${e}`);
  }

  const backupDir = resolve(dbPath, '../backups');
  const backups = listBackups(backupDir);
  let lastBackupAt: number | null = null;
  if (backups.length > 0) {
    try {
      lastBackupAt = statSync(backups[backups.length - 1]!).mtimeMs;
    } catch {
      // Backup file was deleted between listBackups and statSync — safe to ignore.
    }
  }

  const result: Omit<CachedStats, 'cachedAt'> = { dbSizeBytes, lastBackupAt, backupCount: backups.length };
  statsCache = { ...result, cachedAt: now };
  return result;
}

// Minimal warn shim used inside getFsStats before we have a fastify instance.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function fastify_log_warn(msg: string) { console.warn(msg); }

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async () => {
    // Simple DB liveness check
    let dbOk = false;
    try {
      fastify.db.prepare('SELECT 1').get();
      dbOk = true;
    } catch { /* DB unreachable */ }

    const { dbSizeBytes, lastBackupAt, backupCount } = getFsStats();

    return {
      ok: dbOk,
      time: Date.now(),
      version: VERSION,
      db: {
        ok: dbOk,
        sizeBytes: dbSizeBytes,
      },
      backup: {
        count: backupCount,
        lastBackupAt,
      },
    };
  });
};
