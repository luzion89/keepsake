import type { FastifyPluginAsync } from 'fastify';
import { PullRespSchema, PushReqSchema, PushRespSchema, type Conflict, type RejectedOp } from '@keepsake/shared';
import { changesSince, mergeUpsert, deleteRow, logConflict, applyQtyDelta, applyPatch } from '../db/queries.js';

export const syncRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { since?: string } }>('/sync/pull', async (req, reply) => {
    const since = Number(req.query.since ?? 0);
    const changes = changesSince(fastify.db, isFinite(since) ? since : 0);
    const body = PullRespSchema.parse({ serverTime: Date.now(), changes });
    return body;
  });

  fastify.post('/sync/push', async (req, reply) => {
    const parsed = PushReqSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'VALIDATION_ERROR', details: parsed.error.flatten() };
    }
    const { deviceId, ops } = parsed.data;
    const accepted: string[] = [];
    const conflicts: Conflict[] = [];
    const rejected: RejectedOp[] = [];

    const tx = fastify.db.transaction(() => {
      for (const op of ops) {
        if (op.kind === 'upsert') {
          const id = (op.row as any).id as string;
          const { conflicts: c } = mergeUpsert(fastify.db, op.table, op.row);
          for (const conflict of c) {
            logConflict(fastify.db, op.table, id, deviceId, conflict);
            conflicts.push({ id, table: op.table, field: conflict.field, client: conflict.client, server: conflict.server });
          }
          accepted.push(id);
        } else if (op.kind === 'delete') {
          deleteRow(fastify.db, op.table, op.id, op.updated_at, deviceId);
          accepted.push(op.id);
        } else if (op.kind === 'qty_delta') {
          const ok = applyQtyDelta(fastify.db, op.itemId, op.delta, op.updated_at, deviceId);
          if (ok) {
            accepted.push(op.itemId);
          } else {
            rejected.push({ opId: op.opId, entityId: op.itemId, reason: 'NOT_FOUND' });
          }
        } else if (op.kind === 'patch') {
          const result = applyPatch(fastify.db, op.table, op.id, op.fields as Record<string, unknown>, op.updated_at, op.updated_by);
          if (!result) {
            // Row not found: skip patch (upsert should arrive first via outbox ordering)
            fastify.log.warn({ table: op.table, id: op.id }, '[sync/patch] unknown id — skipping');
            rejected.push({ opId: op.opId, entityId: op.id, reason: 'NOT_FOUND' });
            continue;
          }
          for (const conflict of result.conflicts) {
            if ((op.fields as any)[conflict.field] !== undefined) {
              logConflict(fastify.db, op.table, op.id, deviceId, conflict);
              conflicts.push({ id: op.id, table: op.table, field: conflict.field, client: conflict.client, server: conflict.server });
            }
          }
          accepted.push(op.id);
        }
      }
    });
    tx();

    return PushRespSchema.parse({ serverTime: Date.now(), accepted, conflicts, rejected });
  });
};
