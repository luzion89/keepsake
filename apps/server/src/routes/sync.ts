import type { FastifyPluginAsync } from 'fastify';
import { PullRespSchema, PushReqSchema, PushRespSchema, type Conflict } from '@keepsake/shared';
import { changesSince, getRow, mergeUpsert, deleteRow, logConflict } from '../db/queries.js';

export const syncRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { since?: string } }>('/sync/pull', async (req, reply) => {
    const since = Number(req.query.since ?? 0);
    const familyId = (req as any).jwtPayload?.family_id as string | undefined;
    const changes = changesSince(fastify.db, isFinite(since) ? since : 0, familyId);
    const body = PullRespSchema.parse({ serverTime: Date.now(), changes });
    return body;
  });

  fastify.post('/sync/push', async (req, reply) => {
    const parsed = PushReqSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid', details: parsed.error.flatten() };
    }
    const { deviceId, ops } = parsed.data;
    const familyId = (req as any).jwtPayload?.family_id as string | undefined;
    const accepted: string[] = [];
    const conflicts: Conflict[] = [];

    const tx = fastify.db.transaction(() => {
      for (const op of ops) {
        if (op.kind === 'upsert') {
          const id = (op.row as any).id as string;
          const { conflicts: c } = mergeUpsert(fastify.db, op.table, op.row, familyId);
          for (const conflict of c) {
            logConflict(fastify.db, op.table, id, deviceId, conflict);
            conflicts.push({ id, table: op.table, field: conflict.field, client: conflict.client, server: conflict.server });
          }
          accepted.push(id);
        } else if (op.kind === 'delete') {
          deleteRow(fastify.db, op.table, op.id, op.updated_at, deviceId, familyId);
          accepted.push(op.id);
        } else if (op.kind === 'qty_delta') {
          const local = getRow(fastify.db, 'item', op.itemId, familyId);
          if (local) {
            local.qty = (local.qty ?? 0) + op.delta;
            local.updated_at = Math.max(local.updated_at, op.updated_at);
            local.updated_by = deviceId;
            local.version = (local.version ?? 0) + 1;
            if (familyId) local.family_id = familyId;
            mergeUpsert(fastify.db, 'item', local, familyId);
            accepted.push(op.itemId);
          }
        }
      }
    });
    tx();

    return PushRespSchema.parse({ serverTime: Date.now(), accepted, conflicts });
  });
};
