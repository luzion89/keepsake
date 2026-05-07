// AI router: OpenRouter-only, client-side direct calls.
// Key is stored locally (IndexedDB KV) and also synced to the server via the
// settings sync record so other devices/the server can read the same config.

import { kvGet, kvSet } from '../db/dexie.js';

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
export const DEFAULT_TRANSCRIBE_MODEL = 'openai/whisper-1';

const KEY = 'ai_config';

export async function getAiConfig(): Promise<AiConfig> {
  return (await kvGet<AiConfig>(KEY)) ?? { mode: 'off' };
}

export async function setAiConfig(cfg: AiConfig): Promise<void> {
  await kvSet(KEY, cfg);
  // Best-effort: mirror to server so the same key works on other devices.
  // Failures are silent — sync layer also picks it up via the regular cycle.
  try {
    await fetch('/settings/ai', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cfg),
    });
  } catch { /* offline; will retry next sync */ }
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
  if (cfg.mode === 'on' && cfg.apiKey) {
    try { return await callOpenRouterVision(blobs, cfg); }
    catch (e) { console.warn('openrouter vision failed', e); }
  }
  return { status: 'pending', items: [] };
}

/**
 * Transcribe an audio Blob via OpenRouter (Whisper-style model).
 * Note: OpenRouter exposes /audio/transcriptions for select audio models.
 */
export async function transcribe(audio: Blob): Promise<{ text: string }> {
  const cfg = await getAiConfig();
  if (cfg.mode !== 'on' || !cfg.apiKey) throw new Error('AI 未启用或未配置 OpenRouter Key');
  const fd = new FormData();
  fd.append('file', audio, 'voice.webm');
  fd.append('model', cfg.transcribeModel || DEFAULT_TRANSCRIBE_MODEL);
  const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      'HTTP-Referer': location.origin,
      'X-Title': 'Keepsake',
    },
    body: fd,
  });
  if (!res.ok) throw new Error(`transcribe ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { text: j.text ?? '' };
}

/**
 * Parse a free-form Chinese sentence ("我在厨房柜子里放了两瓶消毒水")
 * into a list of items. Uses the same chat model as vision.
 */
export async function parseVoiceText(text: string): Promise<RecognitionItem[]> {
  const cfg = await getAiConfig();
  if (cfg.mode !== 'on' || !cfg.apiKey) throw new Error('AI 未启用或未配置 OpenRouter Key');
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
