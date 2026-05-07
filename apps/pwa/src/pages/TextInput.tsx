/**
 * TextInput.tsx — 文字录入页 (#65, #78)
 *
 * 流程：用户选择模式（增改/覆盖）→ 输入文字 → parseItemsFromText → 草稿列表（可编辑/删除）→ 确认入库
 *
 * 增改模式（默认）：AI 接收已有物品上下文，输出最终完整列表；前端按 name 匹配 create/update
 * 覆盖模式：先软删该区域所有现有物品，再批量 create 新清单；入库前需二次确认
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AreaRepo, ItemRepo } from '../db/repos.js';
import { parseItemsFromText, type RecognitionItem, type ExistingItem } from '../ai/router.js';
import type { Area, Item } from '@keepsake/shared';

type AreaState = 'loading' | 'not-found' | 'ok';
type InputMode = 'merge' | 'replace';

interface Draft extends RecognitionItem {
  /** ISO date string e.g. "2026-12-31" */
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

  // When mode changes, clear drafts so stale results don't linger
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

    // Replace mode: confirm before destructive action
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
        // Soft-delete all existing items in this area
        for (const it of existingItems) {
          await ItemRepo.remove(it.id);
        }
        // Create all draft items
        for (const d of drafts.filter(d => d.name.trim())) {
          const expires_at = d.expiresDate
            ? new Date(d.expiresDate + 'T00:00:00').getTime()
            : undefined;
          await ItemRepo.create({
            area_id: areaId,
            name: d.name.trim(),
            qty: d.qty || 1,
            source: 'manual',
            expires_at,
            notes: d.notes || undefined,
          });
        }
      } else {
        // Merge mode: match by name → update or create
        const existingByName = new Map(existingItems.map(it => [it.name.trim().toLowerCase(), it]));
        for (const d of drafts.filter(d => d.name.trim())) {
          const expires_at = d.expiresDate
            ? new Date(d.expiresDate + 'T00:00:00').getTime()
            : undefined;
          const matched = existingByName.get(d.name.trim().toLowerCase());
          if (matched) {
            await ItemRepo.update(matched.id, {
              qty: d.qty || 1,
              expires_at,
              notes: d.notes || undefined,
            });
          } else {
            await ItemRepo.create({
              area_id: areaId,
              name: d.name.trim(),
              qty: d.qty || 1,
              source: 'manual',
              expires_at,
              notes: d.notes || undefined,
            });
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
    <div className="space-y-4">
      <div className="text-sm text-slate-400">
        <Link to={`/areas/${areaId}`} className="hover:text-white">← 返回 {area!.name}</Link>
      </div>
      <h1 className="text-xl font-semibold">📝 文字录入 · {area!.name}</h1>

      {/* Mode toggle */}
      <section>
        <div className="flex rounded-lg border border-slate-700 overflow-hidden text-sm">
          <button
            onClick={() => switchMode('merge')}
            className={`flex-1 px-3 py-2 font-medium transition-colors ${
              mode === 'merge'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            增改模式（默认）
          </button>
          <button
            onClick={() => switchMode('replace')}
            className={`flex-1 px-3 py-2 font-medium transition-colors border-l border-slate-700 ${
              mode === 'replace'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            覆盖模式
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {mode === 'merge'
            ? '✏️ AI 将结合现有 ' + existingItems.length + ' 个物品，智能新增或更新'
            : '⚠️ 将清空该区域所有 ' + existingItems.length + ' 个现有物品并全量替换'}
        </p>
      </section>

      {/* Replace mode warning banner */}
      {mode === 'replace' && existingItems.length > 0 && (
        <div className="bg-amber-900/40 border border-amber-700 rounded-lg px-3 py-2 text-amber-300 text-sm">
          ⚠️ 覆盖模式：确认入库将删除该区域所有 {existingItems.length} 个现有物品
        </div>
      )}

      {/* Input area */}
      <section className="space-y-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="例如：两瓶消毒水、一盒抽纸、洗发水三瓶…"
          className="w-full min-h-[120px] max-h-[40vh] bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm resize-y"
        />
        <p className="text-xs text-slate-400">💡 可使用输入法的语音转文字功能</p>
        <div className="flex gap-2">
          <button
            onClick={parse}
            disabled={busy || !text.trim()}
            className="flex-1 px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-slate-950/40 border-t-slate-950 rounded-full animate-spin" />
                解析中…
              </>
            ) : '解析'}
          </button>
          <button
            onClick={clear}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 disabled:opacity-50"
          >
            清空
          </button>
        </div>
      </section>

      {errMsg && (
        <div className="bg-rose-900/40 border border-rose-700 rounded-lg px-3 py-2 text-rose-300 text-sm">
          {errMsg}
        </div>
      )}

      {/* Draft list */}
      {parsed && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-300">
            草稿（请核对，共 {drafts.length} 项）
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
                <li key={i} className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={d.name}
                      onChange={e => updateDraft(i, { name: e.target.value })}
                      placeholder="物品名称"
                      className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm"
                    />
                    <input
                      type="number"
                      value={d.qty}
                      min={0}
                      onChange={e => updateDraft(i, { qty: Number(e.target.value) })}
                      className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm"
                      aria-label="数量"
                    />
                    {mode === 'merge' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                        isExisting
                          ? 'bg-amber-900/60 text-amber-300'
                          : 'bg-emerald-900/60 text-emerald-300'
                      }`}>
                        {isExisting ? '更新' : '新增'}
                      </span>
                    )}
                    <button
                      onClick={() => removeDraft(i)}
                      className="text-rose-400 hover:text-rose-200 text-lg leading-none px-1"
                      aria-label="删除此行"
                      title="删除此行"
                    >
                      ×
                    </button>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-xs text-slate-400 w-12">有效期</label>
                    <input
                      type="date"
                      value={d.expiresDate}
                      onChange={e => updateDraft(i, { expiresDate: e.target.value })}
                      className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm"
                    />
                  </div>
                  <textarea
                    value={d.notes ?? ''}
                    onChange={e => updateDraft(i, { notes: e.target.value })}
                    placeholder="备注（可选）"
                    rows={1}
                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm resize-none"
                  />
                </li>
              );
            })}
          </ul>

          <button
            onClick={() => setDrafts(arr => [...arr, { name: '', qty: 1, expiresDate: '', notes: '' }])}
            className="text-sm text-sky-300 hover:text-sky-200"
          >
            + 手动追加一项
          </button>

          {drafts.length > 0 && (
            <button
              onClick={commit}
              disabled={busy}
              className={`w-full px-4 py-3 rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2 ${
                mode === 'replace'
                  ? 'bg-amber-400 text-slate-950'
                  : 'bg-amber-400 text-slate-950'
              }`}
            >
              {busy ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-slate-950/40 border-t-slate-950 rounded-full animate-spin" />
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
