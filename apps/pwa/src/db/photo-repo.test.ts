/**
 * #19: PhotoRepo.setRecognition pending → done 状态机断言
 * #66: PhotoRepo.create area photo + listFor area
 * Dexie 需要 indexedDB，jsdom 不支持真实 IDB；改用 mock 隔离纯逻辑。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- Mock Dexie 及 db ----------
const mockPhoto = {
  id: 'photo-001',
  parent_type: 'area' as const,
  parent_id: 'area-001',
  taken_at: 1000,
  blob_ref: 'photo-001',
  recognition_status: 'pending' as const,
  updated_at: 100,
  updated_by: 'device-A',
  deleted: false,
  version: 0,
};

// 使用模块级变量模拟 DB 内存状态
let dbPhotos: Record<string, typeof mockPhoto & { recognition_status: string; recognition_result?: unknown; version: number }> = {};
let outboxEntries: unknown[] = [];

vi.mock('../db/dexie.js', () => ({
  db: {
    photos: {
      get: vi.fn(async (id: string) => dbPhotos[id] ?? undefined),
      put: vi.fn(async (row: any) => { dbPhotos[row.id] = row; }),
      where: vi.fn((field: string) => ({
        equals: vi.fn((val: string) => ({
          toArray: vi.fn(async () =>
            Object.values(dbPhotos).filter((p: any) => p[field] === val)
          ),
        })),
      })),
    },
    outbox: {
      add: vi.fn(async (entry: any) => { outboxEntries.push(entry); }),
    },
    blobs: {
      put: vi.fn(),
    },
    items: {
      get: vi.fn(),
      put: vi.fn(),
      where: vi.fn(),
      toArray: vi.fn(async () => []),
    },
    rooms: { toArray: vi.fn(async () => []) },
    areas: { toArray: vi.fn(async () => []) },
  },
  getDeviceId: vi.fn(async () => 'device-A'),
  kvGet: vi.fn(),
  kvSet: vi.fn(),
}));

// 在 mock 之后才 import 被测模块
const { PhotoRepo } = await import('../db/repos.js');

beforeEach(() => {
  // 每次测试前重置状态
  dbPhotos = { 'photo-001': { ...mockPhoto } };
  outboxEntries = [];
});

describe('PhotoRepo.setRecognition — pending → done 状态切换', () => {
  it('从 pending 切换到 done 后，DB 中 recognition_status 为 done', async () => {
    expect(dbPhotos['photo-001']!.recognition_status).toBe('pending');

    await PhotoRepo.setRecognition('photo-001', 'done', [{ name: '苹果', qty: 2 }]);

    expect(dbPhotos['photo-001']!.recognition_status).toBe('done');
    expect(dbPhotos['photo-001']!.recognition_result).toEqual([{ name: '苹果', qty: 2 }]);
  });

  it('状态切换后 version 递增', async () => {
    const before = dbPhotos['photo-001']!.version; // 0
    await PhotoRepo.setRecognition('photo-001', 'done', {});
    expect(dbPhotos['photo-001']!.version).toBe(before + 1);
  });

  it('状态切换后向 outbox 推入一条 upsert 记录', async () => {
    expect(outboxEntries.length).toBe(0);
    await PhotoRepo.setRecognition('photo-001', 'done', {});
    expect(outboxEntries.length).toBe(1);
    const entry = outboxEntries[0] as any;
    expect(entry.op.kind).toBe('upsert');
    expect(entry.op.table).toBe('photo');
  });

  it('photo 不存在时不 throw、不写 outbox', async () => {
    await expect(PhotoRepo.setRecognition('nonexistent', 'done', {})).resolves.toBeUndefined();
    expect(outboxEntries.length).toBe(0);
  });

  it('pending → failed 也能正常切换', async () => {
    await PhotoRepo.setRecognition('photo-001', 'failed', { reason: 'timeout' });
    expect(dbPhotos['photo-001']!.recognition_status).toBe('failed');
  });
});

describe('PhotoRepo.create + listFor area — #66 区域照片存档', () => {
  it('create 以 parent_type=area 写入 DB', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const photo = await PhotoRepo.create({ type: 'area', id: 'area-001' }, blob);
    expect(photo.parent_type).toBe('area');
    expect(photo.parent_id).toBe('area-001');
    expect(photo.recognition_status).toBe('pending');
    expect(dbPhotos[photo.id]).toBeDefined();
  });

  it('create 同时写入 outbox', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    const before = outboxEntries.length;
    await PhotoRepo.create({ type: 'area', id: 'area-001' }, blob);
    expect(outboxEntries.length).toBe(before + 1);
    const entry = outboxEntries[outboxEntries.length - 1] as any;
    expect(entry.op.kind).toBe('upsert');
    expect(entry.op.table).toBe('photo');
  });

  it('listFor area 只返回该 area 的未删除照片', async () => {
    // 插入两张 area-001 和一张 area-002 的照片
    const blob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    await PhotoRepo.create({ type: 'area', id: 'area-001' }, blob);
    await PhotoRepo.create({ type: 'area', id: 'area-001' }, blob);
    await PhotoRepo.create({ type: 'area', id: 'area-002' }, blob);

    const list = await PhotoRepo.listFor('area', 'area-001');
    // 过滤掉 mockPhoto（也是 area-001 且 deleted=false）
    expect(list.every(p => p.parent_type === 'area' && p.parent_id === 'area-001')).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every(p => !p.deleted)).toBe(true);
  });
});
