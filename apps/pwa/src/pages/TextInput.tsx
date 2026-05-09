/**
 * TextInput.tsx — 文字录入页 (#65, #78)
 * 视觉重构 PR-D (#97)
 * Round-10: #194 草稿卡片简化 + detail sheet; #195 新增物品排前; #196 紧凑行高
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AreaRepo, ItemRepo } from '../db/repos.js';
import { parseItemsFromText, type RecognitionItem, type ExistingItem } from '../ai/router.js';
import type { Area, Item } from '@keepsake/shared';
import { AlertTriangle, ChevronLeft, FileText, Lightbulb, Pencil, X } from 'lucide-react';

type AreaState = 'loading' | 'not-found' | 'ok';
type InputMode = 'merge' | 'replace';

interface Draft extends RecognitionItem {
  expiresDate: string;
}

function toExpiresDate(raw?: string | null): string {
  if (!raw) return '';
  return raw.slice(0, 10);
}

// #194: Detail sheet state
interface DetailEdit {
  index: number;
  notes: string;
  expiresDate: string;
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
  // #194: detail sheet
  const [detailEdit, setDetailEdit] = useState<DetailEdit | null>(null);

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
      const mapped = items.map(it => ({
        ...it,
        expiresDate: toExpiresDate(it.expires_at),
        notes: it.notes ?? '',
      }));
      // #195: 增改模式下，新增物品排前，已有物品排后
      if (mode === 'merge') {
        const existingNames = new Set(existingItems.map(it => it.name.trim().toLowerCase()));
        const newItems = mapped.filter(d => !existingNames.has(d.name.trim().toLowerCase()));
        const oldItems = mapped.filter(d => existingNames.has(d.name.trim().toLowerCase()));
        setDrafts([...newItems, ...oldItems]);
      } else {
        setDrafts(mapped);
      }
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
          await ItemRepo.create({ area_id: areaId, name: d.name.trim(), qty: d.qty || 1, unit: d.unit || undefined, source: 'manual', expires_at, notes: d.notes || undefined });
        }
      } else {
        const existingByName = new Map(existingItems.map(it => [it.name.trim().toLowerCase(), it]));
        for (const d of drafts.filter(d => d.name.trim())) {
          const expires_at = d.expiresDate ? new Date(d.expiresDate + 'T00:00:00').getTime() : undefined;
          const matched = existingByName.get(d.name.trim().toLowerCase());
          if (matched) {
            await ItemRepo.update(matched.id, { qty: d.qty || 1, unit: d.unit || undefined, expires_at, notes: d.notes || undefined });
          } else {
            await ItemRepo.create({ area_id: areaId, name: d.name.trim(), qty: d.qty || 1, unit: d.unit || undefined, source: 'manual', expires_at, notes: d.notes || undefined });
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

  if (areaState === 'loading') return <p className="text-ink-muted">加载中…</p>;
  if (areaState === 'not-found') {
    return (
      <div className="space-y-3">
        <p className="text-danger-text flex items-center gap-1.5"><AlertTriangle size={16} strokeWidth={1.5} />找不到该区域（可能已被删除）。</p>
        <Link to="/" className="text-accent hover:text-accent-hover text-sm flex items-center gap-1"><ChevronLeft size={16} strokeWidth={1.5} />返回首页</Link>
      </div>
    );
  }

  const existingNames = new Set(existingItems.map(it => it.name.trim().toLowerCase()));

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1 text-xs text-ink-muted">
        <Link to={`/areas/${areaId}`} className="hover:text-ink transition-colors flex items-center gap-1"><ChevronLeft size={14} strokeWidth={1.5} />{area!.name}</Link>
      </nav>
      <h1 className="text-xl font-semibold text-ink flex items-center gap-2"><FileText size={20} strokeWidth={1.5} />文字录入 · {area!.name}</h1>

      {/* ── 模式切换 segmented control ─────────────────── */}
      <section>
        <div className="bg-paper-card rounded-[12px] p-1 flex gap-1 border border-[var(--border-default)]">
          <button
            onClick={() => switchMode('merge')}
            className={`flex-1 py-2 rounded-[10px] text-sm font-medium transition-all duration-150 ${
              mode === 'merge'
                ? 'bg-ink text-paper'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            增改模式（默认）
          </button>
          <button
            onClick={() => switchMode('replace')}
            className={`flex-1 py-2 rounded-[10px] text-sm font-medium transition-all duration-150 ${
              mode === 'replace'
                ? 'bg-warn text-paper'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            覆盖模式
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          {mode === 'merge'
            ? <><Pencil size={14} strokeWidth={1.5} className="inline-block mr-1" />{'AI 将结合现有 ' + existingItems.length + ' 个物品，智能新增或更新'}</>
            : <><AlertTriangle size={14} strokeWidth={1.5} className="inline-block mr-1" />{'将清空该区域所有 ' + existingItems.length + ' 个现有物品并全量替换'}</>
          }
        </p>
      </section>

      {/* Replace warning */}
      {mode === 'replace' && existingItems.length > 0 && (
        <div className="bg-warn-bg border border-warn/30 rounded-[12px] px-4 py-3 text-warn-text text-sm">
          <span className="flex items-center gap-1.5"><AlertTriangle size={16} strokeWidth={1.5} />覆盖模式：确认入库将删除该区域所有 {existingItems.length} 个现有物品</span>
        </div>
      )}

      {/* ── 输入区 ────────────────────────────────────── */}
      <section className="space-y-3">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="例如：两瓶消毒水、一盒抽纸、洗发水三瓶…"
          rows={5}
          className="w-full bg-paper-card border border-[var(--border-default)] rounded-[12px] px-4 py-3 text-sm leading-relaxed resize-none outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all duration-150 text-ink placeholder:text-ink-muted"
        />
        <p className="text-xs text-ink-muted flex items-center gap-1"><Lightbulb size={12} strokeWidth={1.5} />可使用输入法的语音转文字功能</p>
        <div className="flex gap-2">
          <button
            onClick={parse}
            disabled={busy || !text.trim()}
            className="flex-1 px-4 py-2.5 rounded-[12px] bg-accent hover:bg-accent-hover active:scale-[0.97] text-paper font-medium text-sm shadow-card disabled:opacity-50 flex items-center justify-center gap-2 transition-all duration-150"
          >
            {busy ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-paper/40 border-t-paper rounded-full animate-spin" />
                解析中…
              </>
            ) : '解析'}
          </button>
          <button
            onClick={clear}
            disabled={busy}
            className="px-4 py-2.5 rounded-[12px] border border-[var(--border-default)] text-ink-muted hover:text-ink hover:border-ink/30 disabled:opacity-50 text-sm transition-all"
          >
            清空
          </button>
        </div>
      </section>

      {errMsg && (
        <div className="bg-danger-bg border border-danger/30 rounded-[12px] px-4 py-3 text-danger-text text-sm">
          {errMsg}
        </div>
      )}

      {/* ── 草稿列表（#194 简化卡片 + #196 紧凑行高）──── */}
      {parsed && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            草稿（共 {drafts.length} 项，请核对）
          </h2>

          {drafts.length === 0 && (
            <p className="text-ink-muted text-sm">未识别到任何物品，请修改文本后重新解析。</p>
          )}

          {/* #196: 紧凑卡片列表 space-y-1.5 */}
          <ul className="space-y-1.5">
            {drafts.map((d, i) => {
              const isExisting = existingNames.has(d.name.trim().toLowerCase());
              return (
                // #194: 点击卡片背景 → 弹 detail sheet
                <li
                  key={i}
                  className="bg-paper-card border border-[var(--border-default)] rounded-[12px] px-3 py-2 cursor-pointer hover:border-accent/30 transition-all"
                  onClick={() => setDetailEdit({ index: i, notes: d.notes ?? '', expiresDate: d.expiresDate })}
                >
                  {/* 第一行：名称 + 删除 */}
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <input
                      value={d.name}
                      onChange={e => updateDraft(i, { name: e.target.value })}
                      placeholder="物品名称"
                      className="flex-1 min-w-0 bg-paper-dark border border-[var(--border-default)] rounded-[8px] px-2 py-1 text-sm outline-none focus:border-accent transition-all text-ink placeholder:text-ink-muted"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); removeDraft(i); }}
                      className="shrink-0 text-ink-muted hover:text-danger-text transition-colors flex items-center justify-center w-7 h-7"
                      aria-label="删除此行"
                    ><X size={15} strokeWidth={1.5} /></button>
                  </div>
                  {/* 第二行：qty + unit + tag — 点击不触发 sheet */}
                  <div className="flex items-center gap-2 mt-1.5" onClick={e => e.stopPropagation()}>
                    <input
                      type="number"
                      value={d.qty}
                      min={0}
                      onChange={e => updateDraft(i, { qty: Number(e.target.value) })}
                      className="w-14 bg-paper-dark border border-[var(--border-default)] rounded-[8px] px-2 py-1 text-sm outline-none focus:border-accent transition-all text-ink text-center"
                      aria-label="数量"
                    />
                    <input
                      value={d.unit ?? ''}
                      onChange={e => updateDraft(i, { unit: e.target.value })}
                      placeholder="量词"
                      className="w-14 bg-paper-dark border border-[var(--border-default)] rounded-[8px] px-2 py-1 text-sm outline-none focus:border-accent transition-all text-ink placeholder:text-ink-muted"
                      aria-label="量词"
                    />
                    {mode === 'merge' && (
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                        isExisting
                          ? 'bg-warn-bg text-warn-text'
                          : 'bg-ok-bg text-ok-text'
                      }`}>
                        {isExisting ? '已有' : '新增'}
                      </span>
                    )}
                    <span className="text-xs text-ink-muted/50 ml-auto">点击编辑详情 ›</span>
                  </div>
                </li>
              );
            })}
          </ul>

          <button
            onClick={() => setDrafts(arr => [...arr, { name: '', qty: 1, expiresDate: '', notes: '' }])}
            className="text-sm text-accent hover:text-accent-hover transition-colors"
          >
            + 手动追加一项
          </button>

          {drafts.length > 0 && (
            <button
              onClick={commit}
              disabled={busy}
              className={`w-full py-3.5 rounded-[12px] font-semibold text-base shadow-card disabled:opacity-50 flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98] ${
                mode === 'replace'
                  ? 'bg-warn hover:opacity-90 text-paper'
                  : 'bg-accent hover:bg-accent-hover text-paper'
              }`}
            >
              {busy ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-paper/40 border-t-paper rounded-full animate-spin" />
                  保存中…
                </>
              ) : mode === 'replace'
                ? <><AlertTriangle size={16} strokeWidth={1.5} /><span>{'覆盖入库（' + drafts.filter(d => d.name.trim()).length + ' 项）'}</span></>
                : `确认入库（${drafts.filter(d => d.name.trim()).length} 项）`}
            </button>
          )}
        </section>
      )}

      {/* ── #194 Detail Bottom Sheet ──────────────────── */}
      {detailEdit !== null && (() => {
        const d = drafts[detailEdit.index];
        if (!d) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end"
            onClick={() => setDetailEdit(null)}
          >
            {/* 遮罩 */}
            <div className="absolute inset-0 bg-black/40" />
            {/* Sheet */}
            <div
              className="relative bg-paper-card rounded-t-[20px] p-5 space-y-4 shadow-lg"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold text-ink">编辑详情：{d.name || '（未命名）'}</h3>
                <button
                  onClick={() => setDetailEdit(null)}
                  className="w-7 h-7 flex items-center justify-center text-ink-muted hover:text-ink"
                  aria-label="关闭"
                ><X size={16} strokeWidth={1.5} /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-ink-muted block mb-1">备注</label>
                  <input
                    value={detailEdit.notes}
                    onChange={e => setDetailEdit(s => s ? { ...s, notes: e.target.value } : s)}
                    placeholder="可选备注…"
                    className="w-full bg-paper-dark border border-[var(--border-default)] rounded-[10px] px-3 py-2 text-sm outline-none focus:border-accent transition-all text-ink placeholder:text-ink-muted"
                  />
                </div>
                <div>
                  <label className="text-xs text-ink-muted block mb-1">过期时间</label>
                  <input
                    type="date"
                    value={detailEdit.expiresDate}
                    onChange={e => setDetailEdit(s => s ? { ...s, expiresDate: e.target.value } : s)}
                    className="w-full bg-paper-dark border border-[var(--border-default)] rounded-[10px] px-3 py-2 text-sm outline-none focus:border-accent transition-all text-ink"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setDetailEdit(null)}
                  className="flex-1 py-2.5 rounded-[12px] border border-[var(--border-default)] text-ink-muted hover:text-ink text-sm transition-all"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    updateDraft(detailEdit.index, {
                      notes: detailEdit.notes,
                      expiresDate: detailEdit.expiresDate,
                    });
                    setDetailEdit(null);
                  }}
                  className="flex-1 py-2.5 rounded-[12px] bg-accent hover:bg-accent-hover text-paper text-sm font-medium transition-all"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
