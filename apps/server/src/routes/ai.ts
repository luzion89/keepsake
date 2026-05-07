// AI settings storage (single-user app: store one row in `kv`).
// Client PUTs the OpenRouter config here so other devices pick it up on next sync.
import type { FastifyPluginAsync } from 'fastify';
import { AiConfigSchema } from '@keepsake/shared';

/** GET 时用 schema 做 default 兜底，防止历史脏数据直接 throw。 */
function safeParseConfig(raw: unknown) {
  const result = AiConfigSchema.safeParse(raw);
  if (result.success) return result.data;
  // 兜底：只保留合法字段，其余置为 default
  return { mode: 'off' as const };
}

export const aiRoutes: FastifyPluginAsync = async (fastify) => {
  // kv 表已在 schema.sql 中定义，无需运行时建表。
  fastify.get('/settings/ai', async () => {
    const row = fastify.db.prepare('SELECT v, updated_at FROM kv WHERE k = ?').get('ai_config') as { v: string; updated_at: number } | undefined;
    if (!row) return { mode: 'off', updated_at: 0 };
    try {
      const cfg = JSON.parse(row.v);
      const safe = safeParseConfig(cfg);
      return { ...safe, updated_at: row.updated_at };
    } catch { return { mode: 'off', updated_at: 0 }; }
  });

  fastify.put('/settings/ai', async (req, reply) => {
    const parsed = AiConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: '请求体校验失败', details: parsed.error.flatten() };
    }
    fastify.db.prepare(
      `INSERT INTO kv (k, v, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`
    ).run('ai_config', JSON.stringify(parsed.data), Date.now());
    return { ok: true };
  });
};
