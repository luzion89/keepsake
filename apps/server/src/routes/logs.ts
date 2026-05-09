import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const LogEntrySchema = z.object({
  ts: z.number().int(),
  level: z.enum(['error', 'warn', 'info']),
  code: z.string().max(64),
  message: z.string().max(1000),
  context: z.unknown().optional(),
});

const BodySchema = z.object({
  logs: z.array(LogEntrySchema).min(1).max(500),
});

export const logsRoutes: FastifyPluginAsync = async (fastify) => {
  // Ensure table exists (idempotent)
  fastify.db.exec(`
    CREATE TABLE IF NOT EXISTS client_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL,
      code TEXT NOT NULL,
      message TEXT NOT NULL,
      context TEXT,
      received_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS client_logs_ts ON client_logs(ts);
  `);

  const insert = fastify.db.prepare(
    `INSERT INTO client_logs (ts, level, code, message, context, received_at)
     VALUES (@ts, @level, @code, @message, @context, @received_at)`,
  );

  fastify.post('/logs', async (req, reply) => {
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid payload', details: parsed.error.flatten() });
    }
    const receivedAt = Date.now();
    const insertMany = fastify.db.transaction((logs: z.infer<typeof BodySchema>['logs']) => {
      for (const entry of logs) {
        insert.run({
          ts: entry.ts,
          level: entry.level,
          code: entry.code,
          message: entry.message,
          context: entry.context !== undefined ? JSON.stringify(entry.context) : null,
          received_at: receivedAt,
        });
      }
    });
    insertMany(parsed.data.logs);
    return { ok: true, received: parsed.data.logs.length };
  });
};
