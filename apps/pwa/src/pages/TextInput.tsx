/**
 * TextInput.tsx — 文字录入页 (#65)
 *
 * 流程：用户输入文字 → parseItemsFromText → 草稿列表（可编辑/删除）→ 确认入库
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AreaRepo, ItemRepo } from '../db/repos.js';
import { parseItemsFromText, type RecognitionItem } from '../ai/router.js';
import type { Area } from '@keepsake/shared';

type AreaState = 'loading' | 'not-found' | 'ok';

interface Draft extends RecognitionItem {
  /** ISO date string e.g. "2026-12-31" */
  expiresDate: string;
}

function toExpiresDate(raw?: string | null): string {
  if (!raw) return '';
  // raw may be ISO date "2026-12-31" or full ISO datetime
  return raw.slice(0, 10);
}

export function TextInputPage() {
  const { areaId = '' } = useParams();
  const nav = useNavigate();

  const [areaState, setAreaState] = useState<AreaState>('loading');
  const [area, setArea] = useState<Area | undefined>();
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [parsed, setParsed] = useState(false);

  useEffect(() => {
    if (!areaId) { setAreaState('not-found'); return; }
    (async () => {
      const a = await AreaRepo.get(areaId);
      if (a) { setArea(a); setAreaState('ok'); }
      else { setAreaState('not-found'); }
    })();
  }, [areaId]);

  const parse = async () => {
    if (!text.trim()) return;
    setErrMsg(null);
    setBusy(true);
    try {
      const items = await parseItemsFromText(text);
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
    setBusy(true);
    setErrMsg(null);
    try {
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

      {/* Input area */}
      <section className="space-y-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="例如：两瓶消毒水、一盒抽纸、洗发水三瓶…"
          className="w-full min-h-[200px] bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm resize-y"
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
            {drafts.map((d, i) => (
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
            ))}
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
              className="w-full px-4 py-3 rounded-xl bg-amber-400 text-slate-950 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-slate-950/40 border-t-slate-950 rounded-full animate-spin" />
                  保存中…
                </>
              ) : `确认入库（${drafts.filter(d => d.name.trim()).length} 项）`}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
