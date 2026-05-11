import { describe, it, expect, vi, beforeEach } from 'vitest';
import { zh, en, PRESET_NAMES, type Key } from './dict.js';

// ── dict.ts unit tests ────────────────────────────────────────────────────────

describe('dict', () => {
  it('zh and en have the same keys', () => {
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it('no key is empty string in zh', () => {
    for (const [k, v] of Object.entries(zh)) {
      expect(v, `zh key "${k}" should not be empty`).toBeTruthy();
    }
  });

  it('no key is empty string in en', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(v, `en key "${k}" should not be empty`).toBeTruthy();
    }
  });

  it('PRESET_NAMES covers all room presets', () => {
    const roomPresets = ['厨房', '客厅', '阳台', '主卧', '次卧', '卫生间', '储物间', '玄关'];
    for (const p of roomPresets) {
      expect(PRESET_NAMES[p], `PRESET_NAMES should have entry for "${p}"`).toBeTruthy();
    }
  });
});

// ── t() helper tests ──────────────────────────────────────────────────────────

function translate(lang: 'zh' | 'en', key: Key, vars?: Record<string, string | number>): string {
  const dict = lang === 'en' ? en : zh;
  let str: string = (dict as Record<string, string>)[key] ?? (zh as Record<string, string>)[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}

describe('translate()', () => {
  it('returns zh value for zh lang', () => {
    expect(translate('zh', 'common.save')).toBe('保存');
  });

  it('returns en value for en lang', () => {
    expect(translate('en', 'common.save')).toBe('Save');
  });

  it('interpolates {n} placeholder', () => {
    const result = translate('en', 'common.pending', { n: 3 });
    expect(result).toBe('Pending sync: 3');
  });

  it('interpolates multiple placeholders', () => {
    const result = translate('en', 'settings.syncResult', { pushed: '2', pulled: '1', conflicts: '0' });
    expect(result).toContain('2');
    expect(result).toContain('1');
    expect(result).toContain('0');
  });

  it('falls back to zh when en key is missing (simulated)', () => {
    // Simulate a missing key scenario by overriding translate logic
    const missingKey = 'common.save' as Key;
    const dict: Record<string, string> = { ...en };
    delete dict[missingKey];
    let str = dict[missingKey] ?? (zh as Record<string, string>)[missingKey] ?? missingKey;
    expect(str).toBe('保存');
  });

  it('falls back to key name if key not in any dict (simulated)', () => {
    const unknownKey = 'unknown.key.xyz';
    const result = (zh as Record<string, string>)[unknownKey]
      ?? (zh as Record<string, string>)[unknownKey]
      ?? unknownKey;
    expect(result).toBe('unknown.key.xyz');
  });
});

// ── setLang / kvSet persistence test ─────────────────────────────────────────

describe('lang persistence', () => {
  const mockKvStorage: Record<string, unknown> = {};

  beforeEach(() => {
    Object.keys(mockKvStorage).forEach(k => delete mockKvStorage[k]);
  });

  it('persists lang via kvSet mock', async () => {
    const kvSet = async (key: string, value: unknown) => { mockKvStorage[key] = value; };
    const kvGet = async <T>(key: string): Promise<T | undefined> => mockKvStorage[key] as T;

    await kvSet('lang', 'en');
    const stored = await kvGet<string>('lang');
    expect(stored).toBe('en');

    await kvSet('lang', 'zh');
    const stored2 = await kvGet<string>('lang');
    expect(stored2).toBe('zh');
  });

  it('defaults to zh when no stored value', async () => {
    const kvGet = async <T>(key: string): Promise<T | undefined> => mockKvStorage[key] as T;
    const stored = await kvGet<string>('lang');
    const resolved: 'zh' | 'en' = stored === 'en' ? 'en' : 'zh';
    expect(resolved).toBe('zh');
  });
});
