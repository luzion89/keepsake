/**
 * #225: patch op — repos.ts update() 路径测试
 * 验证：
 * - ItemRepo.update 仅改 name → patch op（非 upsert）
 * - ItemRepo.update 改 tags（数组字段）→ fallback upsert
 * - ItemRepo.update 实际无变化 → 不入 outbox
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Item } from '@keepsake/shared';

// ── Mock Dexie DB ──────────────────────────────────────────────────
let dbItems: Record<string, Item> = {};
let outboxEntries: unknown[] = [];

vi.mock('../db/dexie.js', () => ({
  db: {
    items: {
      get: vi.fn(async (id: string) => dbItems[id] ?? undefined),
      put: vi.fn(async (row: Item) => { dbItems[row.id] = row; }),
    },
    outbox: {
      add: vi.fn(async (entry: unknown) => { outboxEntries.push(entry); }),
    },
  },
  getDeviceId: vi.fn(async () => 'device-test'),
}));

const { ItemRepo } = await import('./repos.js');

const BASE_ITEM: Item = {
  id: 'item-0001-0000-0000-000000000001',
  area_id: 'area-0001-0000-0000-000000000001',
  name: 'original',
  qty: 1,
  unit: '个',
  tags: ['food'],
  photo_ids: [],
  source: 'manual',
  created_at: 100,
  updated_at: 100,
  updated_by: 'device-old',
  deleted: false,
  version: 2,
};

beforeEach(() => {
  dbItems = { [BASE_ITEM.id]: { ...BASE_ITEM } };
  outboxEntries = [];
});

describe('ItemRepo.update #225 patch op', () => {
  it('只改 name（标量）→ outbox 入的是 patch op，不是 upsert', async () => {
    await ItemRepo.update(BASE_ITEM.id, { name: 'new name' });
    expect(outboxEntries).toHaveLength(1);
    const op = (outboxEntries[0] as any).op;
    expect(op.kind).toBe('patch');
    expect(op.table).toBe('item');
    expect(op.id).toBe(BASE_ITEM.id);
    expect(op.fields).toMatchObject({ name: 'new name' });
    expect(op.fields).not.toHaveProperty('qty'); // unchanged field not included
    expect(op.base_version).toBe(2);
  });

  it('改 tags（数组字段）→ fallback upsert', async () => {
    await ItemRepo.update(BASE_ITEM.id, { tags: ['food', 'drink'] });
    expect(outboxEntries).toHaveLength(1);
    const op = (outboxEntries[0] as any).op;
    expect(op.kind).toBe('upsert');
    expect(op.table).toBe('item');
  });

  it('改 photo_ids（数组字段）→ fallback upsert', async () => {
    await ItemRepo.update(BASE_ITEM.id, { photo_ids: ['photo-1'] });
    expect(outboxEntries).toHaveLength(1);
    const op = (outboxEntries[0] as any).op;
    expect(op.kind).toBe('upsert');
  });

  it('实际无变化（name 相同）→ 不入 outbox', async () => {
    await ItemRepo.update(BASE_ITEM.id, { name: 'original' });
    expect(outboxEntries).toHaveLength(0);
  });

  it('同时改标量和数组字段 → fallback upsert', async () => {
    await ItemRepo.update(BASE_ITEM.id, { name: 'new', tags: ['x'] });
    expect(outboxEntries).toHaveLength(1);
    const op = (outboxEntries[0] as any).op;
    expect(op.kind).toBe('upsert');
  });

  it('patch op 包含 updated_at 和 updated_by', async () => {
    await ItemRepo.update(BASE_ITEM.id, { name: 'hello' });
    const op = (outboxEntries[0] as any).op;
    expect(typeof op.updated_at).toBe('number');
    expect(op.updated_by).toBe('device-test');
  });

  it('本地 db 写入 next 行，不论是否入队', async () => {
    await ItemRepo.update(BASE_ITEM.id, { name: 'updated' });
    expect(dbItems[BASE_ITEM.id].name).toBe('updated');
  });
});
