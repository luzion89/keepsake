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

  // AI answer state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<SearchAnswerResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);

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
      <h1 className="text-2xl font-bold text-ink">搜索物品</h1>

      {/* ── 搜索栏（sticky）──────────────────────────── */}
      <div className="flex gap-2 sticky top-14 z-10 bg-paper/95 backdrop-blur pb-3 pt-1 -mx-4 px-4 border-b border-ink-faint">
        <textarea
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            // 自适应高度
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          onFocus={(e) => {
            setInputFocused(true);
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          onBlur={(e) => {
            setInputFocused(false);
            // 失焦后恢复单行高度
            e.target.style.height = '';
          }}
          placeholder="如 消毒水、电池、备用灯泡…"
          rows={1}
          className="flex-1 bg-paper-card border border-[var(--border-default)] rounded-[12px] px-4 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all duration-150 text-ink placeholder:text-ink-muted resize-none overflow-hidden leading-[1.5]"
          style={{ minHeight: '44px' }}
        />
        {(aiEnabled || q.trim()) && (
          <button
            onClick={askAi}
            disabled={aiLoading || !q.trim()}
            className="px-4 self-start h-11 rounded-[12px] bg-accent hover:bg-accent-hover text-paper font-medium text-sm disabled:opacity-50 transition-all duration-150 active:scale-[0.97]"
          >
            {aiLoading ? '思考中…' : '✨ AI'}
          </button>
        )}
      </div>

      {q.trim() && items.length === 0 && (
        <p className="text-ink-muted text-sm">没有找到 "{q}"。</p>
      )}

      {/* ── 搜索结果列表 ─────────────────────────────── */}
      {grouped.map(([areaId, list]) => {
        const a = areas.get(areaId);
        const r = a ? rooms.get(a.room_id) : undefined;
        return (
          <section key={areaId}>
            <Link
              to={`/areas/${areaId}`}
              className="block text-xs text-ink-muted font-medium uppercase tracking-wide hover:text-ink mb-1.5 transition-colors"
            >
              {r?.name ?? '?'} / {a?.name ?? '?'}
            </Link>
            <ul className="space-y-1.5">
              {list.map(it => (
                <li key={it.id}>
                  <Link
                    to={`/items/${it.id}`}
                    className={`block px-4 py-2.5 rounded-[12px] bg-paper-card border hover:border-accent/40 transition-all duration-150 ${
                      citedSet.has(it.id) ? 'border-accent/60 ring-1 ring-accent/20' : 'border-[var(--border-default)]'
                    }`}
                  >
                    <span className="text-sm font-medium text-ink">{it.name}</span>
                    <span className="text-ink-muted text-xs ml-2">× {it.qty}</span>
                    {citedSet.has(it.id) && (
                      <span className="ml-2 text-xs text-accent">✨ AI 引用</span>
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
        <section className="mt-2 p-4 rounded-[12px] bg-paper-card border border-accent/30 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-accent">
            ✨ AI 回答
          </div>
          {aiError && (
            <p className="text-danger-text text-sm">{aiError}</p>
          )}
          {aiResult && (
            <p className="text-ink text-sm leading-relaxed whitespace-pre-wrap">{aiResult.answer}</p>
          )}
        </section>
      )}

      {/* ── 📌 AI 提到的物品 ──────────────────────────── */}
      {citedItems.length > 0 && (
        <section className="mt-2">
          <p className="text-xs text-ink-muted font-medium mb-2">📌 AI 提到的物品</p>
          <div className="flex flex-wrap gap-2">
            {citedItems.map(it => (
              <Link
                key={it.id}
                to={`/items/${it.id}`}
                className="bg-accent-light border border-accent/40 text-ink rounded-full px-3 py-1 text-xs hover:bg-accent/20 transition-colors"
              >
                {it.name}
                <span className="text-accent ml-1">{it.locationLabel}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
