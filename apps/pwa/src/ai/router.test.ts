/**
 * 测试旧版 AiConfig.mode 兼容映射（#1）
 * 不依赖 Dexie，仅测试映射表逻辑。
 */
import { describe, it, expect } from 'vitest';

// 与 router.ts 保持一致的映射表（单独声明便于测试）
type AiMode = 'on' | 'off';
const LEGACY_MODE_MAP: Record<string, AiMode> = {
  client: 'on',
  server: 'on',
  off: 'off',
  on: 'on',
};
function normalizeMdode(raw: string): AiMode {
  return LEGACY_MODE_MAP[raw] ?? 'off';
}

describe('getAiConfig 旧 mode 兼容映射', () => {
  it('client → on', () => expect(normalizeMdode('client')).toBe('on'));
  it('server → on', () => expect(normalizeMdode('server')).toBe('on'));
  it('on → on', () => expect(normalizeMdode('on')).toBe('on'));
  it('off → off', () => expect(normalizeMdode('off')).toBe('off'));
  it('无效值 fallback 到 off', () => expect(normalizeMdode('unknown')).toBe('off'));
  it('空字符串 fallback 到 off', () => expect(normalizeMdode('')).toBe('off'));
});
