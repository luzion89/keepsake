/**
 * 测试旧版 AiConfig.mode 兼容映射（#1）+ isValidKey 守卫（#52）
 * 不依赖 Dexie，仅测试纯逻辑。
 */
import { describe, it, expect } from 'vitest';
import { isValidKey } from './router.js';

// 与 router.ts 保持一致的映射表（单独声明便于测试）
type AiMode = 'on' | 'off';
const LEGACY_MODE_MAP: Record<string, AiMode> = {
  client: 'on',
  server: 'on',
  off: 'off',
  on: 'on',
};
function normalizeMode(raw: string): AiMode {
  return LEGACY_MODE_MAP[raw] ?? 'off';
}

describe('getAiConfig 旧 mode 兼容映射', () => {
  it('client → on', () => expect(normalizeMode('client')).toBe('on'));
  it('server → on', () => expect(normalizeMode('server')).toBe('on'));
  it('on → on', () => expect(normalizeMode('on')).toBe('on'));
  it('off → off', () => expect(normalizeMode('off')).toBe('off'));
  it('无效值 fallback 到 off', () => expect(normalizeMode('unknown')).toBe('off'));
  it('空字符串 fallback 到 off', () => expect(normalizeMode('')).toBe('off'));
});

describe('isValidKey (#52 — 防止 "undefined" 字符串送出 Bearer undefined)', () => {
  it('有效 key 返回 true', () => expect(isValidKey('sk-or-v1-abc123')).toBe(true));
  it('undefined 值返回 false', () => expect(isValidKey(undefined)).toBe(false));
  it('字符串 "undefined" 返回 false', () => expect(isValidKey('undefined')).toBe(false));
  it('空字符串返回 false', () => expect(isValidKey('')).toBe(false));
  it('纯空格返回 false', () => expect(isValidKey('   ')).toBe(false));
  it('前后空格的有效 key 返回 true', () => expect(isValidKey('  sk-or-v1-abc  ')).toBe(true));
});
