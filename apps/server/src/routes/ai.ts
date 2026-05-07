// AI settings storage (single-user app: store one row in `kv`).
// Client PUTs the OpenRouter config here so other devices pick it up on next sync.
import type { FastifyPluginAsync } from 'fastify';

export const aiRoutes: FastifyPluginAsync = async (fastify) => {
  // Ensure kv table exists (idempotent — migrate may already have created it).
  fastify.db.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL)`);

  fastify.get('/settings/ai', async () => {
    const row = fastify.db.prepare('SELECT v FROM kv WHERE k = ?').get('ai_config') as { v: string } | undefined;
    if (!row) return { mode: 'off' };
    try { return JSON.parse(row.v); } catch { return { mode: 'off' }; }
  });

  fastify.put('/settings/ai', async (req, reply) => {
    const body = req.body as unknown;
    if (!body || typeof body !== 'object') { reply.code(400); return { error: 'invalid body' }; }
    fastify.db.prepare(
      `INSERT INTO kv (k, v, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`
    ).run('ai_config', JSON.stringify(body), Date.now());
    return { ok: true };
  });
};
