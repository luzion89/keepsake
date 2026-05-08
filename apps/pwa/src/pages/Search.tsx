import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pin, Sparkles } from 'lucide-react';
import type { Item, Area, Room } from '@keepsake/shared';
import { db } from '../db/dexie.js';
import { ItemRepo } from '../db/repos.js';
import { getAiConfig, getEffectiveApiKey, searchAnswer } from '../ai/router.js';
import type { SearchContext, SearchAnswerResult } from '../ai/router.js';

/** Simple in-app toast (auto-dismisses after 2.5 s) */
function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2500);
  };
  const node = msg ? (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-[12px] bg-ink text-paper text-sm shadow-lg whitespace-nowrap pointer-events-none">
      {msg}
    </div>
  ) : null;
  return { show, node };
}

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

  const toast = useToast();

  // Check if AI is available
  useEffect(() => {
    getAiConfig().then(cfg => setAiEnabled(cfg.mode === 'on' && !!getEffectiveApiKey(cfg)));
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
    if (!aiEnabled) {
      toast.show('请先在设置里启用 AI 功能');
      return;
    }
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

  // Build cited items list for the Pin section
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
      {toast.node}

      <h1 className="text-2xl font-bold font-serif text-ink">搜索物品</h1>

      {/* ── 使用提示卡片 ──────────────────────────────── */}
      <div className="bg-paper-card border border-ink/10 rounded-[12px] px-4 py-3 text-sm text-ink-muted leading-relaxed">
        直接搜索关键词，也可以用语音输入一段模糊的描述，让 AI 帮忙查找符合描述的物品
      </div>

      {/* ── 搜索输入框 + AI 按钮 ─────────────────────── */}
      <div className="flex gap-2">
        <textarea
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          onFocus={(e) => {
            e.target.style.overflow = 'hidden';
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          onBlur={(e) => {
            e.target.style.height = '48px';
            e.target.style.overflow = 'hidden';
          }}
          placeholder="输入关键词…"
          rows={1}
          className="flex-1 bg-paper-card border border-[var(--border-default)] rounded-[12px] px-4 py-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all duration-150 text-ink placeholder:text-ink-muted resize-none overflow-hidden leading-[1.5]"
          style={{ minHeight: '48px' }}
        />
        {/* AI 按钮 — 始终渲染 */}
        <button
          onClick={askAi}
          disabled={aiLoading}
          className={`self-start h-12 px-4 flex items-center justify-center gap-1.5 rounded-[12px] font-medium text-sm transition-all duration-150 active:scale-[0.97] ${
            aiEnabled && q.trim()
              ? 'bg-accent hover:bg-accent-hover text-paper'
              : 'border border-[var(--border-default)] text-ink-muted opacity-60'
          }`}
        >
          {aiLoading ? (
            '思考中…'
          ) : (
            <>
              <Sparkles size={16} strokeWidth={1.5} />
              AI
            </>
          )}
        </button>
      </div>

      {/* ── 搜索结果 ──────────────────────────────────── */}
      {q.trim() && items.length === 0 && (
        <p className="text-ink-muted text-sm pt-2">没有找到 "{q}"。</p>
      )}

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
                      <span className="ml-2 text-xs text-accent inline-flex items-center gap-0.5">
                        <Sparkles size={10} strokeWidth={1.5} />
                        AI 引用
                      </span>
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
            <Sparkles size={16} strokeWidth={1.5} />
            AI 回答
          </div>
          {aiError && (
            <p className="text-danger-text text-sm">{aiError}</p>
          )}
          {aiResult && (
            <p className="text-ink text-sm leading-relaxed whitespace-pre-wrap">{aiResult.answer}</p>
          )}
        </section>
      )}

      {/* ── AI 提到的物品 ──────────────────────────── */}
      {citedItems.length > 0 && (
        <section className="mt-2">
          <p className="text-xs text-ink-muted font-medium mb-2 flex items-center gap-1">
            <Pin size={12} strokeWidth={1.5} />
            AI 提到的物品
          </p>
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
