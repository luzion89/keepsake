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

    // Collect up to 30 candidates (from keyword search; if none, use all items capped)
    let candidates = items.slice(0, 30);
    if (candidates.length === 0) {
      // query didn't hit keyword search, still pass top 30 from all
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

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">搜索物品</h1>
      <div className="flex gap-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="如 消毒水、电池、备用灯泡…"
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
        />
        <button
          onClick={startVoice}
          className={`px-4 rounded-lg ${listening ? 'bg-rose-500 text-slate-950' : 'border border-slate-700'}`}
        >
          🎙
        </button>
        {aiEnabled && q.trim() && (
          <button
            onClick={askAi}
            disabled={aiLoading}
            className="px-3 rounded-lg bg-violet-600 text-white text-sm disabled:opacity-50"
          >
            {aiLoading ? '思考中…' : '✨ AI 回答'}
          </button>
        )}
      </div>

      {q.trim() && items.length === 0 && (
        <p className="text-slate-400 text-sm">没有找到 "{q}"。</p>
      )}

      {grouped.map(([areaId, list]) => {
        const a = areas.get(areaId);
        const r = a ? rooms.get(a.room_id) : undefined;
        return (
          <section key={areaId}>
            <Link
              to={`/areas/${areaId}`}
              className="block text-sm text-slate-400 hover:text-white mb-1"
            >
              {r?.name ?? '?'} / {a?.name ?? '?'}
            </Link>
            <ul className="space-y-1">
              {list.map(it => (
                <li key={it.id}>
                  <Link
                    to={`/items/${it.id}`}
                    className={`block px-4 py-2 rounded-lg bg-slate-800 border hover:border-sky-500 ${
                      citedSet.has(it.id) ? 'border-violet-500 ring-1 ring-violet-500/40' : 'border-slate-700'
                    }`}
                  >
                    <span className="font-medium">{it.name}</span>
                    <span className="text-slate-400 text-sm ml-2">× {it.qty}</span>
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

      {/* AI Answer section */}
      {(aiResult || aiError) && (
        <section className="mt-4 p-4 rounded-xl bg-slate-800 border border-violet-700 space-y-2">
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
    </div>
  );
}
