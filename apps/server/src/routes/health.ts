import type { FastifyPluginAsync } from 'fastify';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { listBackups } from '../backup.js';

const VERSION = '0.1.0';

interface HealthStats {
  dbSizeBytes: number | null;
  lastBackupAt: number | null;
  backupCount: number;
}

/** In-memory snapshot refreshed in the background every 10 seconds. */
let _stats: HealthStats = { dbSizeBytes: null, lastBackupAt: null, backupCount: 0 };

function refreshStats(): void {
  const dbPath = resolve(process.env.KEEPSAKE_DB ?? './data/keepsake.sqlite');
  let dbSizeBytes: number | null = null;
  try {
    dbSizeBytes = statSync(dbPath).size;
  } catch (e) {
    // ENOENT is expected on first boot; other errors are unexpected.
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') console.warn(`[health] unexpected stat error for ${dbPath}: ${e}`);
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
  _stats = { dbSizeBytes, lastBackupAt, backupCount: backups.length };
}

// Seed on module load, then refresh every 10 s in the background.
refreshStats();
const _refreshTimer = setInterval(refreshStats, 10_000);
if (_refreshTimer.unref) _refreshTimer.unref();

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async () => {
    // Simple DB liveness check (cheap: in-process prepared-statement, no FS I/O)
    let dbOk = false;
    try {
      fastify.db.prepare('SELECT 1').get();
      dbOk = true;
    } catch { /* DB unreachable */ }

    // Read pre-computed FS stats — no disk I/O inside the request handler
    const { dbSizeBytes, lastBackupAt, backupCount } = _stats;

    return {
      ok: dbOk,
      time: Date.now(),
      version: VERSION,
      db: { ok: dbOk, sizeBytes: dbSizeBytes },
      backup: { count: backupCount, lastBackupAt },
    };
  });
};
