/**
 * 测试旧版 AiConfig.mode 兼容映射（#1）+ isValidKey 守卫（#52）
 * + transcribe() 走 chat completions 端点（#58）
 * 不依赖 Dexie，仅测试纯逻辑 / mock fetch。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// ---------------------------------------------------------------------------
// transcribe() — #58: 走 chat completions，从 choices[0].message.content 取文本
// ---------------------------------------------------------------------------

// Stub out Dexie kvGet so getAiConfig() returns a configured state
vi.mock('../db/dexie.js', () => ({
  kvGet: vi.fn().mockResolvedValue({ mode: 'on', apiKey: 'sk-or-v1-test' }),
  kvSet: vi.fn().mockResolvedValue(undefined),
}));

describe('transcribe() #58 — chat completions 路径', () => {
  const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
  const mockTranscriptionText = '两瓶消毒水和一盒抽纸';

  beforeEach(() => {
    // Mock FileReader used inside blobToDataUrl
    const mockFileReader = {
      onerror: null as unknown,
      onload: null as unknown,
      readAsDataURL(this: typeof mockFileReader) {
        this.result = 'data:audio/webm;base64,dGVzdA==';
        if (typeof this.onload === 'function') (this.onload as () => void)();
      },
      result: '' as string | ArrayBuffer | null,
      error: null,
    };
    vi.stubGlobal('FileReader', vi.fn(() => mockFileReader));

    // Mock location (not available in node env)
    vi.stubGlobal('location', { origin: 'https://example.com' });

    // Mock fetch to return chat completions response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: mockTranscriptionText } }],
      }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('调用 chat completions 端点（不是 /audio/transcriptions）', async () => {
    const { transcribe } = await import('./router.js');
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
    await transcribe(blob);
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    const url = calls[0][0] as string;
    expect(url).toBe(CHAT_URL);
    expect(url).not.toContain('/audio/transcriptions');
  });

  it('请求 body 含 input_audio 块', async () => {
    const { transcribe } = await import('./router.js');
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
    await transcribe(blob);
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    const content = body.messages[0].content as Array<{ type: string }>;
    expect(content.some((c) => c.type === 'input_audio')).toBe(true);
  });

  it('从 choices[0].message.content 抽取转写文本', async () => {
    const { transcribe } = await import('./router.js');
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
    const result = await transcribe(blob);
    expect(result.text).toBe(mockTranscriptionText);
  });

  it('非 ok 响应时抛出含 status 的错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }));
    const { transcribe } = await import('./router.js');
    const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' });
    await expect(transcribe(blob)).rejects.toThrow('transcribe 401');
  });
});

// ---------------------------------------------------------------------------
// parseItemsFromText() — #64: 新系统 prompt，返回 expires_at / notes 字段
// ---------------------------------------------------------------------------
describe('parseItemsFromText() #64 — 抽取 expires_at / notes', () => {
  const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
  const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

  beforeEach(() => {
    vi.stubGlobal('location', { origin: 'https://example.com' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('OpenRouter provider: 返回含 expires_at 和 notes 的 RecognitionItem[]', async () => {
    const { kvGet } = await import('../db/dexie.js');
    (kvGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: 'on',
      provider: 'openrouter',
      apiKey: 'sk-or-test',
      model: 'google/gemini-2.5-flash-lite',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              items: [
                { name: '牛奶', qty: 2, expires_at: '2026-06-01', notes: '全脂' },
                { name: '面包', qty: 1, expires_at: null },
              ],
            }),
          },
        }],
      }),
    }));

    const { parseItemsFromText } = await import('./router.js');
    const items = await parseItemsFromText('两盒牛奶（全脂，6月1日到期）和一条面包');
    expect(items).toHaveLength(2);
    expect(items[0].expires_at).toBe('2026-06-01');
    expect(items[0].notes).toBe('全脂');
    expect(items[1].expires_at).toBeNull();

    // 确认请求发往 OpenRouter
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toBe(OPENROUTER_URL);
  });

  it('DeepSeek provider: 请求发往 DeepSeek base URL，返回含新字段', async () => {
    const { kvGet } = await import('../db/dexie.js');
    (kvGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: 'on',
      provider: 'deepseek',
      deepseekApiKey: 'sk-ds-test',
      model: 'deepseek-chat',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              items: [{ name: '可乐', qty: 6, expires_at: '2026-12-31', notes: '330ml罐装' }],
            }),
          },
        }],
      }),
    }));

    const { parseItemsFromText } = await import('./router.js');
    const items = await parseItemsFromText('六罐330ml可乐，2026年底过期');
    expect(items[0].name).toBe('可乐');
    expect(items[0].expires_at).toBe('2026-12-31');
    expect(items[0].notes).toBe('330ml罐装');

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toBe(DEEPSEEK_URL);
  });

  it('parseVoiceText 是 parseItemsFromText 的别名', async () => {
    const mod = await import('./router.js');
    expect(mod.parseVoiceText).toBe(mod.parseItemsFromText);
  });

  it('未配置 key 时抛出错误', async () => {
    const { kvGet } = await import('../db/dexie.js');
    (kvGet as ReturnType<typeof vi.fn>).mockResolvedValue({ mode: 'off' });
    const { parseItemsFromText } = await import('./router.js');
    await expect(parseItemsFromText('随便')).rejects.toThrow();
  });
});
