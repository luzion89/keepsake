import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Item, Area, Room } from '@keepsake/shared';
import { db } from '../db/dexie.js';
import { ItemRepo } from '../db/repos.js';
import { getAiConfig, searchAnswer } from '../ai/router.js';
import type { SearchContext, SearchAnswerResult } from '../ai/router.js';

export function SearchPage() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [areas, setAreas] = useState<Map<string, Area>>(new Map());
  const [rooms, setRooms] = useState<Map<string, Room>>(new Map());
  const [listening, setListening] = useState(false);

  // AI answer state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<SearchAnswerResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Check if AI is available
  useEffect(() => {
    getAiConfig().then(cfg => setAiEnabled(cfg.mode === 'on' && !!cfg.apiKey));
  }, []);

  useEffect(() => {
    (async () => {
      const a = await db.areas.toArray();
      const r = await db.rooms.toArray();
      setAreas(new Map(a.map(x => [x.id, x])));
      setRooms(new Map(r.map(x => [x.id, x])));
    })();
  }, []);

  // Reset AI result when query changes
  useEffect(() => {
    setAiResult(null);
    setAiError(null);
  }, [q]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const res = q.trim() ? await ItemRepo.search(q) : [];
      if (!ignore) setItems(res);
    })();
    return () => { ignore = true; };
  }, [q]);

  const grouped = useMemo(() => {
    const g = new Map<string, Item[]>();
    for (const it of items) {
      const key = it.area_id;
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(it);
    }
    return Array.from(g.entries());
  }, [items]);

  const startVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('当前浏览器不支持语音识别，请手动输入。'); return; }
    const rec = new SR();
    rec.lang = 'zh-CN';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.onresult = (e: any) => {
      const text = Array.from(e.results).map((r: any) => r[0].transcript).join('');
      setQ(text);
    };
    rec.start();
  };

  const askAi = async () => {
    if (!q.trim()) return;
    setAiLoading(true);
    setAiResult(null);
    setAiError(null);

    let candidates = items.slice(0, 30);
    if (candidates.length === 0) {
      const all = (await db.items.toArray()).filter(i => !i.deleted).slice(0, 30);
      candidates = all;
    }

    const context: SearchContext[] = candidates.map(it => {
      const area = areas.get(it.area_id);
      const room = area ? rooms.get(area.room_id) : undefined;
      const location = `${room?.name ?? '?'} / ${area?.name ?? '?'}`;
      return { id: it.id, name: it.name, qty: it.qty, unit: it.unit, location, notes: it.notes, tags: it.tags };
    });

    const res = await searchAnswer(q, context);
    setAiLoading(false);
    if (res.ok) {
      setAiResult(res.result);
    } else {
      setAiError(res.error);
    }
  };

  // Highlight items cited by AI
  const citedSet = useMemo(() => new Set(aiResult?.citedIds ?? []), [aiResult]);

  // Build cited items list for the 📌 section
  const citedItems = useMemo(() => {
    if (!aiResult?.citedIds?.length) return [];
    return aiResult.citedIds
      .map(id => items.find(it => it.id === id))
      .filter((it): it is Item => it !== undefined)
      .map(it => {
        const area = areas.get(it.area_id);
        const room = area ? rooms.get(area.room_id) : undefined;
        return { ...it, locationLabel: `${room?.name ?? '?'} / ${area?.name ?? '?'}` };
      });
  }, [aiResult, items, areas, rooms]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-100">搜索物品</h1>

      {/* ── 搜索栏（sticky）──────────────────────────── */}
      <div className="flex gap-2 sticky top-14 z-10 bg-slate-950/90 backdrop-blur pb-3 pt-1 -mx-4 px-4">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="如 消毒水、电池、备用灯泡…"
          className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 transition-all duration-150"
        />
        <button
          onClick={startVoice}
          aria-label="语音输入"
          className={`w-11 h-11 flex items-center justify-center rounded-xl border text-base transition-all ${
            listening
              ? 'bg-rose-600 border-rose-600 animate-pulse text-white'
              : 'border-slate-800 text-slate-400 hover:border-sky-500/60 hover:text-slate-200'
          }`}
        >
          🎙
        </button>
        {aiEnabled && q.trim() && (
          <button
            onClick={askAi}
            disabled={aiLoading}
            className="px-4 h-11 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-sm disabled:opacity-50 transition-all duration-150 active:scale-[0.97]"
          >
            {aiLoading ? '思考中…' : '✨ AI 回答'}
          </button>
        )}
      </div>

      {q.trim() && items.length === 0 && (
        <p className="text-slate-400 text-sm">没有找到 "{q}"。</p>
      )}

      {/* ── 搜索结果列表 ─────────────────────────────── */}
      {grouped.map(([areaId, list]) => {
        const a = areas.get(areaId);
        const r = a ? rooms.get(a.room_id) : undefined;
        return (
          <section key={areaId}>
            <Link
              to={`/areas/${areaId}`}
              className="block text-xs text-slate-500 font-medium uppercase tracking-wide hover:text-slate-300 mb-1.5 transition-colors"
            >
              {r?.name ?? '?'} / {a?.name ?? '?'}
            </Link>
            <ul className="space-y-1.5">
              {list.map(it => (
                <li key={it.id}>
                  <Link
                    to={`/items/${it.id}`}
                    className={`block px-4 py-2.5 rounded-xl bg-slate-900 border hover:border-sky-500/40 transition-all duration-150 ${
                      citedSet.has(it.id) ? 'border-violet-600/60 ring-1 ring-violet-600/20' : 'border-slate-800'
                    }`}
                  >
                    <span className="text-sm font-medium text-slate-100">{it.name}</span>
                    <span className="text-slate-500 text-xs ml-2">× {it.qty}</span>
                    {citedSet.has(it.id) && (
                      <span className="ml-2 text-xs text-violet-400">✨ AI 引用</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {/* ── AI Answer 卡片 ────────────────────────────── */}
      {(aiResult || aiError) && (
        <section className="mt-2 p-4 rounded-2xl bg-slate-900 border border-violet-800/60 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-violet-300">
            ✨ AI 回答
          </div>
          {aiError && (
            <p className="text-rose-400 text-sm">{aiError}</p>
          )}
          {aiResult && (
            <p className="text-slate-100 text-sm leading-relaxed whitespace-pre-wrap">{aiResult.answer}</p>
          )}
        </section>
      )}

      {/* ── 📌 AI 提到的物品 ──────────────────────────── */}
      {citedItems.length > 0 && (
        <section className="mt-2">
          <p className="text-xs text-slate-500 font-medium mb-2">📌 AI 提到的物品</p>
          <div className="flex flex-wrap gap-2">
            {citedItems.map(it => (
              <Link
                key={it.id}
                to={`/items/${it.id}`}
                className="bg-violet-900/40 border border-violet-700/60 text-violet-200 rounded-full px-3 py-1 text-xs hover:bg-violet-800/60 transition-colors"
              >
                {it.name}
                <span className="text-violet-400 ml-1">{it.locationLabel}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
