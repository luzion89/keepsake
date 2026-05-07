// Client-first AI router. Tries the user's own cloud key in the browser; falls
// back to the optional local server proxy when configured; otherwise marks the
// photo as 'pending' so the eventual server-side worker (or a future online
// session) can fill in the recognition result.

import { kvGet, kvSet } from '../db/dexie.js';
import { isServerReachable } from '../sync/client.js';

export type AiProvider = 'openai' | 'gemini';
export type AiMode = 'client' | 'server' | 'off';

export interface AiConfig {
  mode: AiMode;
  provider: AiProvider;
  apiKey?: string;
  model?: string;
}

const KEY = 'ai_config';
export async function getAiConfig(): Promise<AiConfig> {
  return (await kvGet<AiConfig>(KEY)) ?? { mode: 'off', provider: 'openai' };
}
export async function setAiConfig(cfg: AiConfig) { await kvSet(KEY, cfg); }

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

async function callOpenAI(blobs: Blob[], cfg: AiConfig): Promise<RecognitionDraft> {
  const dataUrls = await Promise.all(blobs.map(blobToDataUrl));
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model ?? 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你是家庭仓储助手。仅返回 JSON：{"items":[{"name":string,"qty":number,"confidence":0-1}]}。' },
        { role: 'user', content: [
          { type: 'text', text: '列出图片中所有可见物品。中文命名。看不清就不要瞎猜。' },
          ...dataUrls.map(u => ({ type: 'image_url', image_url: { url: u } })),
        ]},
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(text);
  return { status: 'done', items: Array.isArray(parsed.items) ? parsed.items : [], raw: j };
}

async function callServerProxy(blobs: Blob[]): Promise<RecognitionDraft> {
  const dataUrls = await Promise.all(blobs.map(blobToDataUrl));
  const res = await fetch('/ai/recognize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', imageDataUrls: dataUrls }),
  });
  if (!res.ok) throw new Error(`proxy ${res.status}`);
  const text = await res.text();
  // Server returns OpenAI-shaped response; parse content
  const j = JSON.parse(text);
  const inner = j.choices?.[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(inner);
  return { status: 'done', items: Array.isArray(parsed.items) ? parsed.items : [], raw: j };
}

export async function recognize(blobs: Blob[]): Promise<RecognitionDraft> {
  const cfg = await getAiConfig();

  // 1) Client-first
  if (cfg.mode === 'client' && cfg.apiKey) {
    try { return await callOpenAI(blobs, cfg); } catch (e) { console.warn('client AI failed', e); }
  }
  // 2) Server proxy fallback
  if (cfg.mode !== 'off' && (await isServerReachable())) {
    try { return await callServerProxy(blobs); } catch (e) { console.warn('proxy AI failed', e); }
  }
  // 3) Defer
  return { status: 'pending', items: [] };
}
