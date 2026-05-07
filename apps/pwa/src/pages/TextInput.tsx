/**
 * TextInput.tsx — 文字录入页 (#65, #78)
 * 视觉重构 PR-C (#88)
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AreaRepo, ItemRepo } from '../db/repos.js';
import { parseItemsFromText, type RecognitionItem, type ExistingItem } from '../ai/router.js';
import type { Area, Item } from '@keepsake/shared';

type AreaState = 'loading' | 'not-found' | 'ok';
type InputMode = 'merge' | 'replace';

interface Draft extends RecognitionItem {
  expiresDate: string;
}

function toExpiresDate(raw?: string | null): string {
  if (!raw) return '';
  return raw.slice(0, 10);
}

export function TextInputPage() {
  const { areaId = '' } = useParams();
  const nav = useNavigate();

  const [areaState, setAreaState] = useState<AreaState>('loading');
  const [area, setArea] = useState<Area | undefined>();
  const [existingItems, setExistingItems] = useState<Item[]>([]);
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [parsed, setParsed] = useState(false);
  const [mode, setMode] = useState<InputMode>('merge');

  const loadArea = async () => {
    if (!areaId) { setAreaState('not-found'); return; }
    const a = await AreaRepo.get(areaId);
    if (a) {
      setArea(a);
      setAreaState('ok');
      const items = await ItemRepo.listByArea(areaId);
      setExistingItems(items);
    } else {
      setAreaState('not-found');
    }
  };

  useEffect(() => { loadArea(); }, [areaId]);

  const switchMode = (m: InputMode) => {
    setMode(m);
    setDrafts([]);
    setParsed(false);
    setErrMsg(null);
  };

  const parse = async () => {
    if (!text.trim()) return;
    setErrMsg(null);
    setBusy(true);
    try {
      const contextItems: ExistingItem[] = existingItems.map(it => ({
        name: it.name,
        qty: it.qty,
        expires_at: it.expires_at ? new Date(it.expires_at).toISOString().slice(0, 10) : null,
        notes: it.notes,
      }));
      const items = await parseItemsFromText(text, contextItems, mode);
      setDrafts(items.map(it => ({
        ...it,
        expiresDate: toExpiresDate(it.expires_at),
        notes: it.notes ?? '',
      })));
      setParsed(true);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setText('');
    setDrafts([]);
    setParsed(false);
    setErrMsg(null);
  };

  const updateDraft = (i: number, patch: Partial<Draft>) => {
    setDrafts(arr => arr.map((d, j) => j === i ? { ...d, ...patch } : d));
  };

  const removeDraft = (i: number) => {
    setDrafts(arr => arr.filter((_, j) => j !== i));
  };

  const commit = async () => {
    if (!areaId) { setErrMsg('区域 ID 为空，无法保存。'); return; }
    const current = await AreaRepo.get(areaId);
    if (!current) {
      setErrMsg('该区域已不存在，无法保存物品。请返回首页重新选择区域。');
      setAreaState('not-found');
      return;
    }

    if (mode === 'replace') {
      const existingCount = existingItems.length;
      const msg = existingCount > 0
        ? `覆盖模式将删除该区域现有 ${existingCount} 个物品并替换为新清单，确定继续？`
        : '确认将以下物品录入该区域？';
      if (!window.confirm(msg)) return;
    }

    setBusy(true);
    setErrMsg(null);
    try {
      if (mode === 'replace') {
        for (const it of existingItems) await ItemRepo.remove(it.id);
        for (const d of drafts.filter(d => d.name.trim())) {
          const expires_at = d.expiresDate ? new Date(d.expiresDate + 'T00:00:00').getTime() : undefined;
          await ItemRepo.create({ area_id: areaId, name: d.name.trim(), qty: d.qty || 1, source: 'manual', expires_at, notes: d.notes || undefined });
        }
      } else {
        const existingByName = new Map(existingItems.map(it => [it.name.trim().toLowerCase(), it]));
        for (const d of drafts.filter(d => d.name.trim())) {
          const expires_at = d.expiresDate ? new Date(d.expiresDate + 'T00:00:00').getTime() : undefined;
          const matched = existingByName.get(d.name.trim().toLowerCase());
          if (matched) {
            await ItemRepo.update(matched.id, { qty: d.qty || 1, expires_at, notes: d.notes || undefined });
          } else {
            await ItemRepo.create({ area_id: areaId, name: d.name.trim(), qty: d.qty || 1, source: 'manual', expires_at, notes: d.notes || undefined });
          }
        }
      }
      nav(`/areas/${areaId}`);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : '保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  if (areaState === 'loading') return <p className="text-slate-400">加载中…</p>;
  if (areaState === 'not-found') {
    return (
      <div className="space-y-3">
        <p className="text-rose-300">⚠️ 找不到该区域（可能已被删除）。</p>
        <Link to="/" className="text-sky-400 hover:text-sky-300 text-sm">← 返回首页</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1 text-xs text-slate-500">
        <Link to={`/areas/${areaId}`} className="hover:text-slate-300 transition-colors">← {area!.name}</Link>
      </nav>
      <h1 className="text-xl font-semibold">📝 文字录入 · {area!.name}</h1>

      {/* ── 模式切换 segmented control ─────────────────── */}
      <section>
        <div className="bg-slate-900 rounded-xl p-1 flex gap-1 border border-slate-800">
          <button
            onClick={() => switchMode('merge')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
              mode === 'merge'
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            增改模式（默认）
          </button>
          <button
            onClick={() => switchMode('replace')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
              mode === 'replace'
                ? 'bg-amber-600/80 text-amber-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            覆盖模式
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {mode === 'merge'
            ? '✏️ AI 将结合现有 ' + existingItems.length + ' 个物品，智能新增或更新'
            : '⚠️ 将清空该区域所有 ' + existingItems.length + ' 个现有物品并全量替换'}
        </p>
      </section>

      {/* Replace warning */}
      {mode === 'replace' && existingItems.length > 0 && (
        <div className="bg-amber-900/40 border border-amber-700 rounded-xl px-4 py-3 text-amber-300 text-sm">
          ⚠️ 覆盖模式：确认入库将删除该区域所有 {existingItems.length} 个现有物品
        </div>
      )}

      {/* ── 输入区 ────────────────────────────────────── */}
      <section className="space-y-3">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="例如：两瓶消毒水、一盒抽纸、洗发水三瓶…"
          rows={5}
          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm leading-relaxed resize-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 transition-all duration-150"
        />
        <p className="text-xs text-slate-500">💡 可使用输入法的语音转文字功能</p>
        <div className="flex gap-2">
          <button
            onClick={parse}
            disabled={busy || !text.trim()}
            className="flex-1 px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-[0.97] text-white font-medium text-sm shadow-lg shadow-sky-500/20 disabled:opacity-50 flex items-center justify-center gap-2 transition-all duration-150"
          >
            {busy ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                解析中…
              </>
            ) : '解析'}
          </button>
          <button
            onClick={clear}
            disabled={busy}
            className="px-4 py-2.5 rounded-xl border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 disabled:opacity-50 text-sm transition-all"
          >
            清空
          </button>
        </div>
      </section>

      {errMsg && (
        <div className="bg-rose-900/40 border border-rose-700 rounded-xl px-4 py-3 text-rose-300 text-sm">
          {errMsg}
        </div>
      )}

      {/* ── 草稿列表 ──────────────────────────────────── */}
      {parsed && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            草稿（共 {drafts.length} 项，请核对）
          </h2>

          {drafts.length === 0 && (
            <p className="text-slate-500 text-sm">未识别到任何物品，请修改文本后重新解析。</p>
          )}

          <ul className="space-y-2">
            {drafts.map((d, i) => {
              const isExisting = existingItems.some(
                it => it.name.trim().toLowerCase() === d.name.trim().toLowerCase()
              );
              return (
                <li key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={d.name}
                      onChange={e => updateDraft(i, { name: e.target.value })}
                      placeholder="物品名称"
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-sm outline-none focus:border-sky-400 transition-all"
                    />
                    <input
                      type="number"
                      value={d.qty}
                      min={0}
                      onChange={e => updateDraft(i, { qty: Number(e.target.value) })}
                      className="w-16 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-sm outline-none focus:border-sky-400 transition-all"
                      aria-label="数量"
                    />
                    {mode === 'merge' && (
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                        isExisting
                          ? 'bg-amber-900/60 text-amber-300'
                          : 'bg-emerald-900/60 text-emerald-300'
                      }`}>
                        {isExisting ? '更新' : '新增'}
                      </span>
                    )}
                    <button
                      onClick={() => removeDraft(i)}
                      className="text-slate-600 hover:text-rose-400 text-lg leading-none transition-colors"
                      aria-label="删除此行"
                    >×</button>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-xs text-slate-500 w-12">有效期</label>
                    <input
                      type="date"
                      value={d.expiresDate}
                      onChange={e => updateDraft(i, { expiresDate: e.target.value })}
                      className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-sm outline-none focus:border-sky-400 transition-all"
                    />
                  </div>
                  <textarea
                    value={d.notes ?? ''}
                    onChange={e => updateDraft(i, { notes: e.target.value })}
                    placeholder="备注（可选）"
                    rows={1}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-sm resize-none outline-none focus:border-sky-400 transition-all"
                  />
                </li>
              );
            })}
          </ul>

          <button
            onClick={() => setDrafts(arr => [...arr, { name: '', qty: 1, expiresDate: '', notes: '' }])}
            className="text-sm text-sky-400 hover:text-sky-300 transition-colors"
          >
            + 手动追加一项
          </button>

          {drafts.length > 0 && (
            <button
              onClick={commit}
              disabled={busy}
              className={`w-full py-3.5 rounded-xl font-semibold text-base shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98] ${
                mode === 'replace'
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20'
                  : 'bg-sky-500 hover:bg-sky-400 text-white shadow-sky-500/20'
              }`}
            >
              {busy ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-current/40 border-t-current rounded-full animate-spin" />
                  保存中…
                </>
              ) : mode === 'replace'
                ? `⚠️ 覆盖入库（${drafts.filter(d => d.name.trim()).length} 项）`
                : `确认入库（${drafts.filter(d => d.name.trim()).length} 项）`}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
