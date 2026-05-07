import { describe, it, expect } from 'vitest';
import { mergeItem, applyQtyDelta, mergeRoom } from './merge-rules.js';
import type { Item, Room } from './types.js';

const baseItem = (over: Partial<Item> = {}): Item => ({
  id: '00000000-0000-0000-0000-000000000001',
  area_id: '00000000-0000-0000-0000-000000000aaa',
  name: 'foo',
  qty: 1,
  tags: [],
  photo_ids: [],
  source: 'manual',
  updated_at: 100,
  updated_by: 'A',
  deleted: false,
  version: 0,
  ...over,
});

const baseRoom = (over: Partial<Room> = {}): Room => ({
  id: '00000000-0000-0000-0000-0000000000ff',
  name: 'kitchen',
  photo_ids: [],
  updated_at: 100,
  updated_by: 'A',
  deleted: false,
  version: 0,
  ...over,
});

describe('mergeItem', () => {
  it('LWW: later updated_at wins for scalar', () => {
    const a = baseItem({ name: 'old', updated_at: 100, updated_by: 'A' });
    const b = baseItem({ name: 'new', updated_at: 200, updated_by: 'B' });
    const out = mergeItem(a, b);
    expect(out.merged.name).toBe('new');
    expect(out.conflicts.length).toBe(1);
  });

  it('arrays merged as union', () => {
    const a = baseItem({ tags: ['x', 'y'], photo_ids: ['p1'] });
    const b = baseItem({ tags: ['y', 'z'], photo_ids: ['p2'], updated_at: 200 });
    const { merged } = mergeItem(a, b);
    expect(new Set(merged.tags)).toEqual(new Set(['x', 'y', 'z']));
    expect(new Set(merged.photo_ids)).toEqual(new Set(['p1', 'p2']));
  });

  it('soft delete beats edit', () => {
    const a = baseItem({ deleted: true, updated_at: 50 });
    const b = baseItem({ name: 'edited', updated_at: 999 });
    const { merged } = mergeItem(a, b);
    expect(merged.deleted).toBe(true);
  });

  it('tie on updated_at: deterministic by updated_by (smaller wins)', () => {
    const a = baseItem({ name: 'A-name', updated_at: 100, updated_by: 'A' });
    const b = baseItem({ name: 'B-name', updated_at: 100, updated_by: 'B' });
    const { merged } = mergeItem(a, b);
    expect(merged.name).toBe('A-name'); // 'A' < 'B', local(a) wins
  });
});

describe('applyQtyDelta', () => {
  it('+2 then -1 = +1', () => {
    let it = baseItem({ qty: 5 });
    it = applyQtyDelta(it, 2, 110, 'A'); // 7
    it = applyQtyDelta(it, -1, 120, 'B'); // 6
    expect(it.qty).toBe(6);
  });
});

describe('mergeRoom', () => {
  it('name LWW', () => {
    const a = baseRoom({ name: 'old', updated_at: 1 });
    const b = baseRoom({ name: 'new', updated_at: 2 });
    expect(mergeRoom(a, b).merged.name).toBe('new');
  });
});

// ---------- #21 / #25: LWW updated_at 完全相同时的 tie-breaker 行为（小者胜） ----------
describe('LWW tie-breaker when updated_at is identical', () => {
  it('mergeItem: updated_by 字典序较小的设备（"A" < "Z"）在 local 时 local 胜出', () => {
    // lwwPick: local.updated_by < remote.updated_by → 'local'
    const local = baseItem({ name: 'local-name', updated_at: 100, updated_by: 'A' });
    const remote = baseItem({ name: 'remote-name', updated_at: 100, updated_by: 'Z' });
    const { merged } = mergeItem(local, remote);
    expect(merged.name).toBe('local-name'); // A < Z，local 胜
  });

  it('mergeItem: updated_by 字典序较小的设备（"A"）在 remote 时 remote 胜出', () => {
    const local = baseItem({ name: 'local-name', updated_at: 100, updated_by: 'Z' });
    const remote = baseItem({ name: 'remote-name', updated_at: 100, updated_by: 'A' });
    const { merged } = mergeItem(local, remote);
    expect(merged.name).toBe('remote-name'); // A < Z，remote 胜
  });

  it('mergeItem: updated_by 完全相同时 remote 胜出（终极 fallback）', () => {
    const local = baseItem({ name: 'local-same', updated_at: 100, updated_by: 'SAME' });
    const remote = baseItem({ name: 'remote-same', updated_at: 100, updated_by: 'SAME' });
    const { merged } = mergeItem(local, remote);
    expect(merged.name).toBe('remote-same'); // same → remote fallback
  });

  it('mergeRoom: tie-breaker 规则与 mergeItem 一致（updated_by 字典序小者胜）', () => {
    const a = baseRoom({ name: 'room-A', updated_at: 500, updated_by: 'device-A' });
    const b = baseRoom({ name: 'room-B', updated_at: 500, updated_by: 'device-B' });
    const { merged } = mergeRoom(a, b);
    // 'device-A' < 'device-B' → local(a) 胜
    expect(merged.name).toBe('room-A');
  });

  it('mergeItem: updated_by 不同时，小者胜（device-1 < device-2）', () => {
    const local = baseItem({ name: 'dev1-name', updated_at: 200, updated_by: 'device-1' });
    const remote = baseItem({ name: 'dev2-name', updated_at: 200, updated_by: 'device-2' });
    const { merged } = mergeItem(local, remote);
    expect(merged.name).toBe('dev1-name'); // 'device-1' < 'device-2'
  });
});
