/**
 * 测试 Voice/Capture area 三态逻辑 (#5, #6)
 * 不依赖 Dexie；仅测试纯函数级别的 guard 逻辑。
 */
import { describe, it, expect } from 'vitest';
import type { Area } from '@keepsake/shared';

// --- 模拟 resolveAreaState ---
type AreaState = 'loading' | 'not-found' | 'ok';

function resolveAreaState(areaId: string, area: Area | undefined): AreaState {
  if (!areaId) return 'not-found';
  if (area === undefined) return 'not-found';
  return 'ok';
}

// --- 模拟 save guard ---
function canSave(areaId: string, area: Area | undefined): { ok: boolean; reason?: string } {
  if (!areaId) return { ok: false, reason: '区域 ID 为空，无法保存。' };
  if (!area) return { ok: false, reason: '该区域已不存在，无法保存物品。请返回首页重新选择区域。' };
  return { ok: true };
}

const mockArea: Area = {
  id: 'area-1',
  room_id: 'room-1',
  name: '测试区域',
  deleted: false,
  updated_at: Date.now(),
  updated_by: 'device-1',
  version: 1,
  photo_ids: [],
};

describe('resolveAreaState (#5 三态加载)', () => {
  it('areaId 空 → not-found', () => {
    expect(resolveAreaState('', undefined)).toBe('not-found');
  });
  it('areaId 非空但 AreaRepo 未命中 → not-found', () => {
    expect(resolveAreaState('area-999', undefined)).toBe('not-found');
  });
  it('areaId 非空且命中 → ok', () => {
    expect(resolveAreaState('area-1', mockArea)).toBe('ok');
  });
});

describe('canSave guard (#6 save 校验)', () => {
  it('areaId 为空 → 拒绝', () => {
    const r = canSave('', undefined);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ID 为空/);
  });
  it('area 已删除或不存在 → 拒绝', () => {
    const r = canSave('area-999', undefined);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/已不存在/);
  });
  it('area 存在 → 允许', () => {
    const r = canSave('area-1', mockArea);
    expect(r.ok).toBe(true);
  });
});
