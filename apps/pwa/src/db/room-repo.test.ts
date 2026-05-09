/**
 * #113: RoomRepo 竞态回归测试
 * 验证：多次并发调用 list() 返回一致结果，create() + list() 不产生重复
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Room } from '@keepsake/shared';

// ── 模拟 DB 内存状态 ──────────────────────────────────────────────
let dbRooms: Record<string, Room> = {};
let outboxEntries: unknown[] = [];

vi.mock('../db/dexie.js', () => ({
  db: {
    rooms: {
      toArray: vi.fn(async () => Object.values(dbRooms)),
      get: vi.fn(async (id: string) => dbRooms[id] ?? undefined),
      put: vi.fn(async (row: Room) => { dbRooms[row.id] = row; }),
    },
    outbox: {
      add: vi.fn(async (entry: unknown) => { outboxEntries.push(entry); }),
    },
  },
  getDeviceId: vi.fn(async () => 'device-test'),
}));

// ── 导入被测模块（在 mock 注册后）──────────────────────────────────
const { RoomRepo } = await import('./repos.js');

// ── 测试 ──────────────────────────────────────────────────────────
beforeEach(() => {
  dbRooms = {};
  outboxEntries = [];
});

describe('RoomRepo #113 竞态回归', () => {
  it('初始 DB 为空时 list() 返回空数组', async () => {
    const rooms = await RoomRepo.list();
    expect(rooms).toHaveLength(0);
  });

  it('create() 后 list() 应返回该房间，不重复', async () => {
    await RoomRepo.create({ name: '厨房' });
    const rooms = await RoomRepo.list();
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.name).toBe('厨房');
  });

  it('create() 调用两次后 list() 返回 2 条，不重复', async () => {
    await RoomRepo.create({ name: '厨房' });
    await RoomRepo.create({ name: '客厅' });
    const rooms = await RoomRepo.list();
    // 关键断言：严格不重复
    const ids = rooms.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rooms).toHaveLength(2);
  });

  it('并发调用 list() 多次，结果一致', async () => {
    await RoomRepo.create({ name: '主卧' });
    // 并发调用 3 次 list()
    const [r1, r2, r3] = await Promise.all([
      RoomRepo.list(),
      RoomRepo.list(),
      RoomRepo.list(),
    ]);
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r3).toHaveLength(1);
    expect(r1[0]!.id).toBe(r2[0]!.id);
    expect(r2[0]!.id).toBe(r3[0]!.id);
  });

  it('软删除的房间不应出现在 list() 中', async () => {
    const room = await RoomRepo.create({ name: '储物间' });
    await RoomRepo.remove(room.id);
    const rooms = await RoomRepo.list();
    expect(rooms.every(r => r.id !== room.id)).toBe(true);
  });

  it('reload 场景：list() 调用两次返回相同结果（无副作用）', async () => {
    await RoomRepo.create({ name: '书房' });
    const first = await RoomRepo.list();
    const second = await RoomRepo.list();
    expect(first).toHaveLength(second.length);
    expect(first[0]!.id).toBe(second[0]!.id);
  });
});
