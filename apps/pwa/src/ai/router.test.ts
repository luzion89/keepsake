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

// ---------------------------------------------------------------------------
// parseItemsFromText() #78 — replace vs merge mode prompt 形态
// ---------------------------------------------------------------------------
describe('parseItemsFromText() #78 — replace/merge 模式 prompt', () => {
  const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

  beforeEach(() => {
    vi.stubGlobal('location', { origin: 'https://example.com' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('replace 模式：system prompt 不含已有物品列表', async () => {
    const { kvGet } = await import('../db/dexie.js');
    (kvGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: 'on', provider: 'openrouter', apiKey: 'sk-or-test',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ items: [] }) } }] }),
    }));
    const { parseItemsFromText } = await import('./router.js');
    await parseItemsFromText('两瓶可乐', [], 'replace');
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    const sysPrompt: string = body.messages[0].content;
    // Replace mode uses the standard prompt — no existing items JSON
    expect(sysPrompt).not.toContain('现有物品列表');
    expect(body.messages[0].role).toBe('system');
  });

  it('merge 模式：system prompt 含已有物品 JSON', async () => {
    const { kvGet } = await import('../db/dexie.js');
    (kvGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: 'on', provider: 'openrouter', apiKey: 'sk-or-test',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ items: [{ name: '牛奶', qty: 3, expires_at: null }] }) } }],
      }),
    }));
    const { parseItemsFromText } = await import('./router.js');
    const existing = [{ name: '牛奶', qty: 2, expires_at: '2026-06-01', notes: '全脂' }];
    const items = await parseItemsFromText('再加一盒牛奶', existing, 'merge');
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    const sysPrompt: string = body.messages[0].content;
    expect(sysPrompt).toContain('现有物品列表');
    expect(sysPrompt).toContain('牛奶');
    expect(items[0].name).toBe('牛奶');
    // Verify request went to OpenRouter
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(OPENROUTER_URL);
  });

  it('merge 模式但无已有物品：降级为标准 prompt', async () => {
    const { kvGet } = await import('../db/dexie.js');
    (kvGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: 'on', provider: 'openrouter', apiKey: 'sk-or-test',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ items: [] }) } }] }),
    }));
    const { parseItemsFromText } = await import('./router.js');
    await parseItemsFromText('一瓶醋', [], 'merge');
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    // Empty existing → fallback to standard prompt
    expect(body.messages[0].content).not.toContain('现有物品列表');
  });
});

// ---------------------------------------------------------------------------
// searchAnswer() #89 — prompt 不含 [id] 引用要求
// ---------------------------------------------------------------------------
describe('searchAnswer() #89 — system prompt 不要求 AI 在 answer 中使用 [id] 标注', () => {
  const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

  beforeEach(() => {
    vi.stubGlobal('location', { origin: 'https://example.com' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('system prompt 不包含要求在 answer 中嵌入 id 的指令', async () => {
    const { kvGet } = await import('../db/dexie.js');
    (kvGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: 'on', provider: 'openrouter', apiKey: 'sk-or-test',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({ answer: '消毒水在主卧的洗手台柜子，共2瓶。', citedIds: ['abc-123'] }),
          },
        }],
      }),
    }));

    const { searchAnswer } = await import('./router.js');
    const ctx = [{ id: 'abc-123', name: '消毒水', qty: 2, location: '主卧 / 洗手台柜子' }];
    await searchAnswer('消毒水在哪里', ctx);

    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    const sysPrompt: string = body.messages[0].content;

    // Must NOT instruct AI to embed [id] in answer
    expect(sysPrompt).not.toMatch(/在文中用\s*\[id\]/);
    expect(sysPrompt).not.toContain('请在文中用 [id] 标注');

    // Must explicitly say not to include ids in answer
    expect(sysPrompt).toContain('不要在回答中包含任何 id');
  });

  it('context block 格式把 id 放在行末注释而非行首 [id] 前缀', async () => {
    const { kvGet } = await import('../db/dexie.js');
    (kvGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: 'on', provider: 'openrouter', apiKey: 'sk-or-test',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({ answer: '消毒水在主卧。', citedIds: ['abc-123'] }),
          },
        }],
      }),
    }));

    const { searchAnswer } = await import('./router.js');
    const ctx = [{ id: 'abc-123', name: '消毒水', qty: 2, location: '主卧 / 洗手台柜子' }];
    await searchAnswer('消毒水', ctx);

    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    const sysPrompt: string = body.messages[0].content;

    // id should appear as trailing comment (id:xxx), not as leading [xxx]
    expect(sysPrompt).toContain('(id:abc-123)');
    expect(sysPrompt).not.toContain('[abc-123]');
  });

  it('searchAnswer 正确返回 answer 和 citedIds', async () => {
    const { kvGet } = await import('../db/dexie.js');
    (kvGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: 'on', provider: 'openrouter', apiKey: 'sk-or-test',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({ answer: '消毒水在主卧的洗手台柜子。', citedIds: ['abc-123'] }),
          },
        }],
      }),
    }));

    const { searchAnswer } = await import('./router.js');
    const ctx = [{ id: 'abc-123', name: '消毒水', qty: 2, location: '主卧 / 洗手台柜子' }];
    const res = await searchAnswer('消毒水在哪里', ctx);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.answer).toBe('消毒水在主卧的洗手台柜子。');
      expect(res.result.citedIds).toEqual(['abc-123']);
      // answer must not contain UUID-like strings
      expect(res.result.answer).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    }
  });
});
