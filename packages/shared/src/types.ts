import { z } from 'zod';

// ---------- Sync metadata mixin ----------
export const SyncMetaSchema = z.object({
  id: z.string().uuid(),
  updated_at: z.number().int().nonnegative(),
  updated_by: z.string().min(1), // deviceId
  deleted: z.boolean().default(false),
  version: z.number().int().nonnegative().default(0),
});
export type SyncMeta = z.infer<typeof SyncMetaSchema>;

// ---------- Domain ----------
export const RoomSchema = SyncMetaSchema.extend({
  name: z.string().min(1).max(60),
  icon: z.string().max(40).optional(),
  photo_ids: z.array(z.string().uuid()).default([]),
  note: z.string().max(2000).optional(),
});
export type Room = z.infer<typeof RoomSchema>;

export const AreaSchema = SyncMetaSchema.extend({
  room_id: z.string().uuid(),
  name: z.string().min(1).max(80),
  photo_ids: z.array(z.string().uuid()).default([]),
  note: z.string().max(2000).optional(),
});
export type Area = z.infer<typeof AreaSchema>;

export const BBoxSchema = z.object({
  photoId: z.string().uuid(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const ItemSchema = SyncMetaSchema.extend({
  area_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  qty: z.number().int(),
  unit: z.string().max(20).optional(),
  tags: z.array(z.string().max(40)).default([]),
  photo_ids: z.array(z.string().uuid()).default([]),
  expires_at: z.number().int().nonnegative().optional(),
  source: z.enum(['ai', 'voice', 'manual']),
  confidence: z.number().min(0).max(1).optional(),
  bbox: BBoxSchema.optional(),
  notes: z.string().max(4000).optional(),
});
export type Item = z.infer<typeof ItemSchema>;

export const PhotoSchema = SyncMetaSchema.extend({
  parent_type: z.enum(['room', 'area', 'item']),
  parent_id: z.string().uuid(),
  taken_at: z.number().int().nonnegative(),
  blob_ref: z.string().min(1).optional(),     // local IDB key
  remote_url: z.string().url().optional(),    // after upload
  recognition_status: z.enum(['pending', 'done', 'failed', 'skipped']),
  recognition_result: z.unknown().optional(),
});
export type Photo = z.infer<typeof PhotoSchema>;

export const SnapshotSchema = SyncMetaSchema.extend({
  area_id: z.string().uuid(),
  taken_at: z.number().int().nonnegative(),
  item_ids: z.array(z.string().uuid()),
  note: z.string().max(2000).optional(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const ReminderRuleSchema = SyncMetaSchema.extend({
  item_id: z.string().uuid(),
  kind: z.enum(['expiry', 'low_stock', 'recheck']),
  threshold_at: z.number().int().nonnegative().optional(),
  threshold_qty: z.number().int().optional(),
  note: z.string().max(500).optional(),
  last_fired_at: z.number().int().nonnegative().optional(),
});
export type ReminderRule = z.infer<typeof ReminderRuleSchema>;

export const TableNameSchema = z.enum(['room', 'area', 'item', 'photo', 'snapshot', 'reminder_rule']);
export type TableName = z.infer<typeof TableNameSchema>;

// ---------- AI 配置（跨设备同步，存于 server kv 表） ----------
export const AiConfigSchema = z.object({
  mode: z.enum(['on', 'off']),
  /**
   * provider 字段：
   * - 新安装默认 'deepseek'。
   * - 旧配置（无此字段）读取时 safeParse 会返回 undefined，调用方应 fallback 到 'openrouter'
   *   以避免已配置 OpenRouter key 的老用户突然失效。
   */
  provider: z.enum(['deepseek', 'openrouter']).optional(),
  /** OpenRouter API key（sk-or-...），保留字段名向后兼容 */
  apiKey: z.string().max(200).optional(),
  /** DeepSeek API key（sk-...），与 apiKey 分开存储 */
  deepseekApiKey: z.string().max(200).optional(),
  /** Vision-capable model id（OpenRouter 专用，DeepSeek 不支持 vision） */
  model: z.string().max(120).optional(),
  /** Optional Whisper-class model for voice transcription（OpenRouter 专用） */
  transcribeModel: z.string().max(120).optional(),
}).strict();
export type AiConfig = z.infer<typeof AiConfigSchema>;
