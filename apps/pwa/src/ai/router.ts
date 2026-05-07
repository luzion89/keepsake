// AI router: OpenRouter-only, client-side direct calls.
// Key is stored locally (IndexedDB KV) and also synced to the server via the
// settings sync record so other devices/the server can read the same config.

import { kvGet, kvSet } from '../db/dexie.js';
import { logger } from '../logging/logger.js';

export type AiMode = 'on' | 'off';

export interface AiConfig {
  mode: AiMode;
  /** OpenRouter API key (sk-or-...) */
  apiKey?: string;
  /** Vision-capable model id, e.g. google/gemini-2.5-flash-lite */
  model?: string;
  /** Optional Whisper-class model for voice transcription. */
  transcribeModel?: string;
}

export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
/** @deprecated transcribe() now uses chat completions with the same model as vision. */
export const DEFAULT_TRANSCRIBE_MODEL = DEFAULT_MODEL;

const KEY = 'ai_config';

/** 旧版本中使用的 mode 值，升级时需要映射到新枚举。 */
const LEGACY_MODE_MAP: Record<string, AiMode> = {
  client: 'on',
  server: 'on',
  off: 'off',
  on: 'on',
};

export async function getAiConfig(): Promise<AiConfig> {
  const raw = await kvGet<AiConfig>(KEY);
  if (!raw) return { mode: 'off' };
  // 兼容旧 mode 值（client/server）：映射到新枚举；无效值 fallback 到 'off'。
  const normalizedMode: AiMode = LEGACY_MODE_MAP[raw.mode as string] ?? 'off';
  if (normalizedMode !== raw.mode) {
    // 顺手写回，避免下次再走兼容路径
    const migrated: AiConfig = { ...raw, mode: normalizedMode };
    await kvSet(KEY, migrated);
    return migrated;
  }
  return raw;
}

export async function setAiConfig(cfg: AiConfig): Promise<{ ok: boolean; error?: string }> {
  // 保存时附上时间戳，供 LWW 比较使用
  const cfgWithTs = { ...cfg, updated_at: Date.now() };
  await kvSet(KEY, cfgWithTs);
  // Best-effort: mirror to server so the same key works on other devices.
  // Returns ok=false with error message when server is unreachable.
  // 注意：剔除 updated_at，服务端 AiConfigSchema.strict() 不接受额外字段（fixes #39/#40）
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
 * 策略：
 *   - 本地无配置（首次使用）→ 直接使用服务端配置。
 *   - 本地有配置且本地 updated_at ≥ 服务端 updated_at → 本地优先，不覆盖。
 *   - 服务端 updated_at 较新 → 用服务端配置覆盖本地。
 * 注意：此函数只 GET，不 PUT，避免循环触发。
 */
export async function pullAiConfigFromServer(): Promise<void> {
  try {
    const res = await fetch('/settings/ai');
    if (!res.ok) return;
    const remote = await res.json() as AiConfig & { updated_at?: number };
    if (!remote || remote.mode === 'off' && !remote.apiKey) return;

    const local = await kvGet<AiConfig & { updated_at?: number }>(KEY);
    const localTs = local?.updated_at ?? 0;
    const remoteTs = remote.updated_at ?? 0;

    if (!local || remoteTs > localTs) {
      // 去掉 updated_at 字段再存入本地（本地 AiConfig 不含此字段）
      const { updated_at: _ts, ...cfg } = remote;
      await kvSet(KEY, cfg as AiConfig);
    }
  } catch { /* 离线或服务不可达，静默忽略 */ }
}

export interface RecognitionItem { name: string; qty: number; confidence?: number; }
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

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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
  if (cfg.mode === 'on' && isValidKey(cfg.apiKey)) {
    try { return await callOpenRouterVision(blobs, cfg); }
    catch (e) {
      logger.error('vision_failed', e instanceof Error ? e.message : String(e), { model: cfg.model });
    }
  }
  return { status: 'pending', items: [] };
}

/**
 * Ping OpenRouter by fetching GET /api/v1/models with the current API key.
 * Validates the key without spending any tokens.
 * Returns { ok: true, latencyMs } on success, { ok: false, error } on failure.
 */
export async function pingOpenRouter(
  apiKey: string,
): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const t0 = Date.now();
  try {
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
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Transcribe an audio Blob via OpenRouter using chat completions with input_audio.
 * OpenRouter does NOT expose /audio/transcriptions; audio goes through the chat
 * completions endpoint as an input_audio content block (OpenAI-style).
 * The default model (google/gemini-2.5-flash-lite) natively supports audio input.
 *
 * Uses blobToDataUrl + strip-prefix to avoid stack overflows from btoa on large buffers.
 */
export async function transcribe(audio: Blob): Promise<{ text: string }> {
  const cfg = await getAiConfig();
  if (cfg.mode !== 'on' || !isValidKey(cfg.apiKey)) throw new Error('AI 未启用或未配置 OpenRouter Key');

  // Derive audio format from MIME type
  const format = audio.type.includes('webm') ? 'webm'
    : audio.type.includes('mp4') || audio.type.includes('m4a') ? 'mp4'
    : audio.type.includes('wav') ? 'wav'
    : 'webm';

  // Use FileReader-based blobToDataUrl then strip the data-URL prefix to get raw base64.
  // This avoids stack overflow from btoa(String.fromCharCode(...new Uint8Array(buf)))
  // on large (>1 MB) buffers.
  const dataUrl = await blobToDataUrl(audio);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

  // Use transcribeModel if explicitly configured, otherwise fall back to the vision model.
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
  location: string; // e.g. "厨房 / 洗手台柜子"
  notes?: string;
  tags?: string[];
}

export interface SearchAnswerResult {
  answer: string;
  /** item ids explicitly mentioned / cited in the answer */
  citedIds: string[];
}

/**
 * Natural-language search: given a user query and up to 30 candidate items
 * (pre-filtered by keyword search), ask the model to answer in Chinese,
 * citing specific items and their locations.
 * Returns { ok: false, error } on failure so callers can surface the error.
 */
export async function searchAnswer(
  query: string,
  contextItems: SearchContext[],
): Promise<{ ok: true; result: SearchAnswerResult } | { ok: false; error: string }> {
  const cfg = await getAiConfig();
  if (cfg.mode !== 'on' || !isValidKey(cfg.apiKey)) {
    return { ok: false, error: 'AI 未启用' };
  }

  // Build a compact context block (~50 chars per item)
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

  try {
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

/**
 * Parse a free-form Chinese sentence ("我在厨房柜子里放了两瓶消毒水")
 * into a list of items. Uses the same chat model as vision.
 */
export async function parseVoiceText(text: string): Promise<RecognitionItem[]> {
  const cfg = await getAiConfig();
  if (cfg.mode !== 'on' || !isValidKey(cfg.apiKey)) throw new Error('AI 未启用或未配置 OpenRouter Key');
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
        { role: 'system', content: '从用户的中文口语描述中抽取物品。仅返回 JSON：{"items":[{"name":string,"qty":number}]}。数字未说默认 1。' },
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
