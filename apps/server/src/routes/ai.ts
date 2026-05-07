// AI settings storage (single-user app: store one row in `kv`).
// Client PUTs the OpenRouter config here so other devices pick it up on next sync.
import type { FastifyPluginAsync } from 'fastify';

export const aiRoutes: FastifyPluginAsync = async (fastify) => {
  // kv 表已在 schema.sql 中定义，无需运行时建表。
  fastify.get('/settings/ai', async () => {
    const row = fastify.db.prepare('SELECT v, updated_at FROM kv WHERE k = ?').get('ai_config') as { v: string; updated_at: number } | undefined;
    if (!row) return { mode: 'off', updated_at: 0 };
    try {
      const cfg = JSON.parse(row.v);
      return { ...cfg, updated_at: row.updated_at };
    } catch { return { mode: 'off', updated_at: 0 }; }
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
