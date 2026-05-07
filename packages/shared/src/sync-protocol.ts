import { z } from 'zod';
import { TableNameSchema } from './types.js';

// One mutation produced by a client.
export const OpSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('upsert'),
    table: TableNameSchema,
    row: z.record(z.unknown()),         // validated table-specifically server-side
  }),
  z.object({
    kind: z.literal('delete'),
    table: TableNameSchema,
    id: z.string().uuid(),
    updated_at: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('qty_delta'),
    itemId: z.string().uuid(),
    delta: z.number().int(),
    updated_at: z.number().int().nonnegative(),
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

export const PushRespSchema = z.object({
  serverTime: z.number().int().nonnegative(),
  accepted: z.array(z.string()),
  conflicts: z.array(ConflictSchema),
});
export type PushResp = z.infer<typeof PushRespSchema>;
