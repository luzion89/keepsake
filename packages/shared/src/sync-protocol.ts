import { z } from 'zod';
import { TableNameSchema } from './types.js';

// One mutation produced by a client.
// `opId` is an optional client-generated identifier (UUID or seq string) used
// to correlate ops in the PushResp accepted/conflicts/rejected arrays.
export const OpSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('upsert'),
    opId: z.string().optional(),
    table: TableNameSchema,
    row: z.record(z.unknown()),         // validated table-specifically server-side
  }),
  z.object({
    kind: z.literal('delete'),
    opId: z.string().optional(),
    table: TableNameSchema,
    id: z.string().uuid(),
    updated_at: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('qty_delta'),
    opId: z.string().optional(),
    itemId: z.string().uuid(),
    delta: z.number().int(),
    updated_at: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('patch'),
    opId: z.string().optional(),
    table: TableNameSchema,
    id: z.string().uuid(),
    fields: z.record(z.unknown()),
    updated_at: z.number().int().nonnegative(),
    updated_by: z.string().min(1),
    base_version: z.number().int().nonnegative(),
  }),
]);
export type Op = z.infer<typeof OpSchema>;

export const PullRespSchema = z.object({
  serverTime: z.number().int().nonnegative(),
  changes: z.array(z.object({
    table: TableNameSchema,
    row: z.record(z.unknown()),
  })),
});
export type PullResp = z.infer<typeof PullRespSchema>;

export const PushReqSchema = z.object({
  deviceId: z.string().min(1),
  ops: z.array(OpSchema),
});
export type PushReq = z.infer<typeof PushReqSchema>;

export const ConflictSchema = z.object({
  id: z.string(),
  table: TableNameSchema,
  field: z.string(),
  client: z.unknown(),
  server: z.unknown(),
});
export type Conflict = z.infer<typeof ConflictSchema>;

export const RejectedOpSchema = z.object({
  opId: z.string().optional(),
  entityId: z.string().optional(),
  reason: z.string(),
});
export type RejectedOp = z.infer<typeof RejectedOpSchema>;

export const PushRespSchema = z.object({
  serverTime: z.number().int().nonnegative(),
  accepted: z.array(z.string()),
  conflicts: z.array(ConflictSchema),
  rejected: z.array(RejectedOpSchema).default([]),
});
export type PushResp = z.infer<typeof PushRespSchema>;
