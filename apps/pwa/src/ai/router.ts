// AI router: supports DeepSeek (default for new installs) and OpenRouter.
// Key is stored locally (IndexedDB KV) and also synced to the server via the
// settings sync record so other devices/the server can read the same config.

import { kvGet, kvSet } from '../db/dexie.js';
import { logger } from '../logging/logger.js';
import type { AiConfig } from '@keepsake/shared';

export type { AiConfig };
export type AiMode = 'on' | 'off';
export type AiProvider = 'deepseek' | 'openrouter';

export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
/** @deprecated transcribe() now uses chat completions with the same model as vision. */
export const DEFAULT_TRANSCRIBE_MODEL = DEFAULT_MODEL;

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const KEY = 'ai_config';

/** 旧版本中使用的 mode 值，升级时需要映射到新枚举。 */
const LEGACY_MODE_MAP: Record<string, AiMode> = {
  client: 'on',
  server: 'on',
  off: 'off',
  on: 'on',
};

/**
 * Resolve the effective provider from a config object.
 * - If provider is explicitly set, use it.
 * - If provider is absent (old config), fall back to 'openrouter' to keep
 *   existing users' OpenRouter key working after upgrade.
 */
export function getEffectiveProvider(cfg: AiConfig): AiProvider {
  return cfg.provider ?? 'openrouter';
}

/** Return the chat completions URL for the given provider. */
export function getEffectiveBaseUrl(cfg: AiConfig): string {
  return getEffectiveProvider(cfg) === 'deepseek' ? DEEPSEEK_URL : OPENROUTER_URL;
}

/** Return the API key for the given provider. */
export function getEffectiveApiKey(cfg: AiConfig): string | undefined {
  return getEffectiveProvider(cfg) === 'deepseek' ? cfg.deepseekApiKey : cfg.apiKey;
}

export async function getAiConfig(): Promise<AiConfig> {
  const raw = await kvGet<AiConfig>(KEY);
  if (!raw) return { mode: 'off' };
  // 兼容旧 mode 值（client/server）：映射到新枚举；无效值 fallback 到 'off'。
  const normalizedMode: AiMode = LEGACY_MODE_MAP[raw.mode as string] ?? 'off';
  if (normalizedMode !== raw.mode) {
    const migrated: AiConfig = { ...raw, mode: normalizedMode };
    await kvSet(KEY, migrated);
    return migrated;
  }
  return raw;
}

export async function setAiConfig(cfg: AiConfig): Promise<{ ok: boolean; error?: string }> {
  const cfgWithTs = { ...cfg, updated_at: Date.now() };
  await kvSet(KEY, cfgWithTs);
  // Best-effort: mirror to server so the same key works on other devices.
  const { updated_at: _ts, ...serverPayload } = cfgWithTs;
  try {
    const res = await fetch('/settings/ai', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(serverPayload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`);
      return { ok: false, error: text.slice(0, 200) };
    }
    return { ok: true };
  } catch (e: unknown) {
    // "failed to fetch" / "NetworkError" 表示请求根本没到达服务器，常见原因：
    // 1. 开发模式：Vite devserver 没代理 /settings → 检查 vite.config.ts
    // 2. 混合内容：页面通过 HTTPS 访问但服务端未启用 TLS（设置 KEEPSAKE_TLS=1）
    // 3. 自签证书未信任：在系统/浏览器中信任 mkcert 生成的证书
    const msg = e instanceof Error ? e.message : String(e);
    const isNetworkError =
      msg.toLowerCase().includes('failed to fetch') ||
      msg.toLowerCase().includes('networkerror') ||
      msg.toLowerCase().includes('network request failed') ||
      e instanceof TypeError;
    if (isNetworkError) {
      const hint = location.protocol === 'https:'
        ? '网络错误（混合内容或证书未信任）：确认服务端已启用 TLS（KEEPSAKE_TLS=1）且证书已信任'
        : '网络错误：服务端不可达，请确认本地服务器已启动';
      return { ok: false, error: hint };
    }
    return { ok: false, error: msg };
  }
}

/**
 * 启动时从服务端拉取 AI 配置并与本地合并（Last-Write-Wins by updated_at）。
 */
export async function pullAiConfigFromServer(): Promise<void> {
  try {
    const res = await fetch('/settings/ai');
    if (!res.ok) return;
    const remote = await res.json() as AiConfig & { updated_at?: number };
    if (!remote || remote.mode === 'off' && !remote.apiKey && !remote.deepseekApiKey) return;

    const local = await kvGet<AiConfig & { updated_at?: number }>(KEY);
    const localTs = local?.updated_at ?? 0;
    const remoteTs = remote.updated_at ?? 0;

    if (!local || remoteTs > localTs) {
      const { updated_at: _ts, ...cfg } = remote;
      await kvSet(KEY, cfg as AiConfig);
    }
  } catch { /* 离线或服务不可达，静默忽略 */ }
}

export interface RecognitionItem {
  name: string;
  qty: number;
  confidence?: number;
  expires_at?: string | null;
  notes?: string;
}
export interface RecognitionDraft {
  status: 'done' | 'pending';
  items: RecognitionItem[];
  raw?: unknown;
}

async function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(r.error);
    r.onload = () => res(r.result as string);
    r.readAsDataURL(b);
  });
}

/**
 * Guard against missing or accidentally-serialised-as-string-"undefined" keys.
 * Fixes #52: old code paths could store the literal string "undefined" in IndexedDB
 * which passes `!cfg.apiKey` (truthy non-empty string) but is rejected by OpenRouter (401).
 */
export function isValidKey(key?: string): key is string {
  return typeof key === 'string' && key.trim() !== '' && key.trim() !== 'undefined';
}

async function callOpenRouterVision(blobs: Blob[], cfg: AiConfig): Promise<RecognitionDraft> {
  const dataUrls = await Promise.all(blobs.map(blobToDataUrl));
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
      'HTTP-Referer': location.origin,
      'X-Title': 'Keepsake',
    },
    body: JSON.stringify({
      model: cfg.model || DEFAULT_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你是家庭仓储助手。仅返回 JSON：{"items":[{"name":string,"qty":number,"confidence":0-1}]}。看不清就不要瞎猜。' },
        { role: 'user', content: [
          { type: 'text', text: '列出图片中所有可见物品。中文命名。' },
          ...dataUrls.map(u => ({ type: 'image_url', image_url: { url: u } })),
        ]},
      ],
    }),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(text);
  return { status: 'done', items: Array.isArray(parsed.items) ? parsed.items : [], raw: j };
}

export async function recognize(blobs: Blob[]): Promise<RecognitionDraft> {
  const cfg = await getAiConfig();
  const provider = getEffectiveProvider(cfg);

  // DeepSeek does not support vision — graceful degradation
  if (provider === 'deepseek') {
    logger.warn('vision_not_supported', 'DeepSeek provider does not support image recognition; use OpenRouter for vision', { provider });
    return { status: 'pending', items: [] };
  }

  if (cfg.mode === 'on' && isValidKey(cfg.apiKey)) {
    try { return await callOpenRouterVision(blobs, cfg); }
    catch (e) {
      logger.error('vision_failed', e instanceof Error ? e.message : String(e), { model: cfg.model });
    }
  }
  return { status: 'pending', items: [] };
}

/**
 * Ping the configured AI provider to validate the API key.
 * Returns { ok: true, latencyMs } on success, { ok: false, error } on failure.
 */
export async function pingProvider(
  provider: AiProvider,
  apiKey: string,
): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const t0 = Date.now();
  try {
    if (provider === 'deepseek') {
      // DeepSeek: use a minimal chat completions call (no models endpoint)
      const res = await fetch('https://api.deepseek.com/v1/models', {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}` },
      });
      const latencyMs = Date.now() - t0;
      if (res.ok) return { ok: true, latencyMs };
      let detail = `HTTP ${res.status}`;
      try { const j = await res.json(); detail = j?.error?.message ?? detail; } catch { /* ignore */ }
      return { ok: false, error: `${res.status}: ${detail}` };
    } else {
      // OpenRouter: fetch models list (no tokens consumed)
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': location.origin,
          'X-Title': 'Keepsake',
        },
      });
      const latencyMs = Date.now() - t0;
      if (res.ok) return { ok: true, latencyMs };
      let detail = `HTTP ${res.status}`;
      try { const j = await res.json(); detail = j?.error?.message ?? detail; } catch { /* ignore */ }
      return { ok: false, error: `${res.status}: ${detail}` };
    }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * @deprecated Use pingProvider('openrouter', apiKey) instead.
 */
export async function pingOpenRouter(
  apiKey: string,
): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  return pingProvider('openrouter', apiKey);
}

/**
 * Transcribe an audio Blob via OpenRouter using chat completions with input_audio.
 * Note: transcribe is OpenRouter-only (#64 will handle provider routing for voice).
 */
export async function transcribe(audio: Blob): Promise<{ text: string }> {
  const cfg = await getAiConfig();
  if (cfg.mode !== 'on' || !isValidKey(cfg.apiKey)) throw new Error('AI 未启用或未配置 OpenRouter Key');

  const format = audio.type.includes('webm') ? 'webm'
    : audio.type.includes('mp4') || audio.type.includes('m4a') ? 'mp4'
    : audio.type.includes('wav') ? 'wav'
    : 'webm';

  const dataUrl = await blobToDataUrl(audio);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

  const model = (cfg.transcribeModel && cfg.transcribeModel.trim())
    ? cfg.transcribeModel.trim()
    : (cfg.model || DEFAULT_MODEL);

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
      'HTTP-Referer': location.origin,
      'X-Title': 'Keepsake',
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '请把这段音频准确转写成中文文本，只返回转写结果，不要其他说明。' },
          { type: 'input_audio', input_audio: { data: base64, format } },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`transcribe ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { text: j.choices?.[0]?.message?.content?.trim() ?? '' };
}

export interface SearchContext {
  id: string;
  name: string;
  qty: number;
  unit?: string;
  location: string;
  notes?: string;
  tags?: string[];
}

export interface SearchAnswerResult {
  answer: string;
  citedIds: string[];
}

/**
 * Natural-language search using the configured AI provider.
 */
export async function searchAnswer(
  query: string,
  contextItems: SearchContext[],
): Promise<{ ok: true; result: SearchAnswerResult } | { ok: false; error: string }> {
  const cfg = await getAiConfig();
  const provider = getEffectiveProvider(cfg);
  const apiKey = getEffectiveApiKey(cfg);

  if (cfg.mode !== 'on' || !isValidKey(apiKey)) {
    return { ok: false, error: 'AI 未启用' };
  }

  const contextBlock = contextItems
    .map(it => {
      const parts = [`[${it.id}] ${it.name} ×${it.qty}${it.unit ?? ''}`, `位置：${it.location}`];
      if (it.notes) parts.push(`备注：${it.notes}`);
      if (it.tags?.length) parts.push(`标签：${it.tags.join('、')}`);
      return parts.join('；');
    })
    .join('\n');

  const systemPrompt = `你是家庭仓储助手。用户查询他们家里存放的物品。
以下是相关物品列表（格式：[id] 名称 数量 位置 备注）：
${contextBlock || '（无匹配物品）'}

请用中文简洁回答用户问题，引用具体物品名称和位置。回答里如需引用物品，请在文中用 [id] 标注。
仅返回 JSON：{"answer": string, "citedIds": string[]}`;

  const url = getEffectiveBaseUrl(cfg);
  const model = provider === 'deepseek'
    ? (cfg.model || DEFAULT_DEEPSEEK_MODEL)
    : (cfg.model || DEFAULT_MODEL);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = 'Keepsake';
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `AI 服务错误 (${res.status})：${text.slice(0, 200)}` };
    }
    const j = await res.json();
    const raw = j.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);
    return {
      ok: true,
      result: {
        answer: typeof parsed.answer === 'string' ? parsed.answer : '（无回答）',
        citedIds: Array.isArray(parsed.citedIds) ? parsed.citedIds : [],
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `请求失败：${msg}` };
  }
}

const PARSE_ITEMS_SYSTEM_PROMPT = `从用户的中文描述中抽取家庭物品清单。每个物品输出 { name, qty, expires_at, notes }：
- qty: 用户没说默认 1
- expires_at: 如果用户提到"过期"、"保质期到"、"X 月前买的可以放 X 个月"等可推断的，输出 ISO 日期字符串（YYYY-MM-DD）；不确定就 null
- notes: 用户对这个物品的额外描述，比如品牌、型号、用途、放置原因等
仅返回 JSON：{"items":[{"name":string,"qty":number,"expires_at":string|null,"notes":string?}]}`;

/**
 * Parse a free-form Chinese sentence into a list of items.
 * Routes to DeepSeek or OpenRouter based on configured provider.
 */
export async function parseItemsFromText(text: string): Promise<RecognitionItem[]> {
  const cfg = await getAiConfig();
  const provider = getEffectiveProvider(cfg);
  const apiKey = getEffectiveApiKey(cfg);

  if (cfg.mode !== 'on' || !isValidKey(apiKey)) {
    throw new Error(provider === 'deepseek'
      ? 'AI 未启用或未配置 DeepSeek Key'
      : 'AI 未启用或未配置 OpenRouter Key');
  }

  const url = getEffectiveBaseUrl(cfg);
  const model = provider === 'deepseek'
    ? (cfg.model || DEFAULT_DEEPSEEK_MODEL)
    : (cfg.model || DEFAULT_MODEL);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = 'Keepsake';
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: PARSE_ITEMS_SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error(`parse ${res.status}`);
  const j = await res.json();
  const inner = j.choices?.[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(inner);
  return Array.isArray(parsed.items) ? parsed.items : [];
}

/**
 * @deprecated Use parseItemsFromText instead.
 * @alias parseItemsFromText
 */
export const parseVoiceText = parseItemsFromText;
