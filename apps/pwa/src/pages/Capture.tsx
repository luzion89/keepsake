import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import imageCompression from 'browser-image-compression';
import { AreaRepo, ItemRepo, PhotoRepo } from '../db/repos.js';
import type { Area } from '@keepsake/shared';
import { recognize, type RecognitionItem, getAiConfig } from '../ai/router.js';

interface Draft extends RecognitionItem {
  selected: boolean;
}

export function CapturePage() {
  const { areaId = '' } = useParams();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [area, setArea] = useState<Area | undefined>();
  const [blobs, setBlobs] = useState<{ blob: Blob; url: string }[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [aiState, setAiState] = useState<'idle' | 'running' | 'pending' | 'done' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => { (async () => setArea(await AreaRepo.get(areaId)))(); }, [areaId]);
  useEffect(() => () => blobs.forEach(b => URL.revokeObjectURL(b.url)), []);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const out: { blob: Blob; url: string }[] = [];
    for (const f of files) {
      const compressed = await imageCompression(f, { maxSizeMB: 0.8, maxWidthOrHeight: 1600, useWebWorker: true });
      out.push({ blob: compressed, url: URL.createObjectURL(compressed) });
    }
    setBlobs(prev => [...prev, ...out]);
    e.target.value = '';
  };

  const runAi = async () => {
    if (blobs.length === 0) return;
    const cfg = await getAiConfig();
    if (cfg.mode === 'off') {
      setErrMsg('AI 未启用。请到「设置」配置 OpenRouter Key。');
      return;
    }
    setAiState('running'); setErrMsg(null);
    try {
      const res = await recognize(blobs.map(b => b.blob));
      if (res.status === 'pending') {
        setAiState('pending');
        setErrMsg('当前无法识别（无 key 或服务器离线），照片已保存为待识别。');
      } else {
        setAiState('done');
        setDrafts(res.items.map(it => ({ ...it, selected: true })));
      }
    } catch (e: any) {
      setAiState('error'); setErrMsg(e?.message ?? String(e));
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      // 1) save photos
      const photoIds: string[] = [];
      for (const b of blobs) {
        const p = await PhotoRepo.create({ type: 'area', id: areaId }, b.blob);
        photoIds.push(p.id);
        if (aiState === 'pending') {
          // mark as pending — already default
        } else if (aiState === 'done') {
          await PhotoRepo.setRecognition(p.id, 'done', drafts);
        }
      }
      // 2) save selected items
      for (const d of drafts.filter(d => d.selected && d.name.trim())) {
        await ItemRepo.create({
          area_id: areaId,
          name: d.name.trim(),
          qty: d.qty || 1,
          source: 'ai',
          confidence: d.confidence,
          photo_ids: photoIds,
        });
      }
      nav(`/areas/${areaId}`);
    } finally {
      setBusy(false);
    }
  };

  if (!area) return <p className="text-slate-400">加载中…</p>;

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-400">
        <Link to={`/areas/${areaId}`} className="hover:text-white">← 返回 {area.name}</Link>
      </div>
      <h1 className="text-xl font-semibold">📷 盘点 · {area.name}</h1>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        onChange={onPick}
        className="hidden"
      />

      <div className="flex gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex-1 px-4 py-3 rounded-xl bg-emerald-500 text-slate-950 font-medium"
        >
          + 拍照 / 选图（可多张）
        </button>
        {blobs.length > 0 && (
          <button
            onClick={runAi}
            disabled={aiState === 'running'}
            className="px-4 py-3 rounded-xl bg-sky-500 text-slate-950 font-medium disabled:opacity-50"
          >
            {aiState === 'running' ? '识别中…' : 'AI 识别'}
          </button>
        )}
      </div>

      {errMsg && <p className="text-rose-300 text-sm">{errMsg}</p>}

      {blobs.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">已选 {blobs.length} 张</h2>
          <div className="grid grid-cols-3 gap-2">
            {blobs.map((b, i) => (
              <img key={i} src={b.url} className="w-full aspect-square object-cover rounded-lg" />
            ))}
          </div>
        </section>
      )}

      {drafts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-300">AI 草稿（请核对）</h2>
          <ul className="space-y-2">
            {drafts.map((d, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
                <input
                  type="checkbox"
                  checked={d.selected}
                  onChange={(e) => setDrafts(arr => arr.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))}
                />
                <input
                  value={d.name}
                  onChange={(e) => setDrafts(arr => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                  className="flex-1 bg-transparent outline-none"
                />
                <input
                  type="number"
                  value={d.qty}
                  min={0}
                  onChange={(e) => setDrafts(arr => arr.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))}
                  className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1"
                />
                {d.confidence != null && (
                  <span className={`text-xs ${d.confidence < 0.6 ? 'text-amber-300' : 'text-slate-400'}`}>
                    {(d.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </li>
            ))}
          </ul>
          <button
            onClick={() => setDrafts(d => [...d, { name: '', qty: 1, selected: true }])}
            className="text-sm text-sky-300 hover:text-sky-200"
          >
            + 手动追加一项
          </button>
        </section>
      )}

      {(blobs.length > 0 || drafts.length > 0) && (
        <button
          onClick={save}
          disabled={busy}
          className="w-full px-4 py-3 rounded-xl bg-amber-400 text-slate-950 font-medium disabled:opacity-50"
        >
          {busy ? '保存中…' : '锁定存档'}
        </button>
      )}
    </div>
  );
}
