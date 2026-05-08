/**
 * Capture.tsx — 区域照片存档（#66）
 *
 * 简化流程：拍照 / 选图 → 压缩 → 存入 IndexedDB photos 表（parent_type='area'）。
 * 不再调用 AI 识别（AI 识别入口移至文本输入流程）。
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import imageCompression from 'browser-image-compression';
import { AreaRepo, PhotoRepo } from '../db/repos.js';
import type { Area } from '@keepsake/shared';

/** Area 加载三态 */
type AreaState = 'loading' | 'not-found' | 'ok';

export function CapturePage() {
  const { areaId = '' } = useParams();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [areaState, setAreaState] = useState<AreaState>('loading');
  const [area, setArea] = useState<Area | undefined>();
  const [blobs, setBlobs] = useState<{ blob: Blob; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!areaId) { setAreaState('not-found'); return; }
    (async () => {
      const a = await AreaRepo.get(areaId);
      if (a) { setArea(a); setAreaState('ok'); }
      else { setAreaState('not-found'); }
    })();
  }, [areaId]);

  // 清理 object URLs
  useEffect(() => () => blobs.forEach(b => URL.revokeObjectURL(b.url)), []);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const out: { blob: Blob; url: string }[] = [];
    for (const f of files) {
      const compressed = await imageCompression(f, {
        maxSizeMB: 0.8,
        maxWidthOrHeight: 1600,
        useWebWorker: true,
      });
      out.push({ blob: compressed, url: URL.createObjectURL(compressed) });
    }
    setBlobs(prev => [...prev, ...out]);
    e.target.value = '';
  };

  const removeBlob = (i: number) => {
    setBlobs(prev => {
      const item = prev[i]; if (item) URL.revokeObjectURL(item.url);
      return prev.filter((_, j) => j !== i);
    });
  };

  const save = async () => {
    if (!areaId) { setErrMsg('区域 ID 为空，无法保存。'); return; }
    if (blobs.length === 0) { setErrMsg('请先选择至少一张照片。'); return; }

    const current = await AreaRepo.get(areaId);
    if (!current) {
      setErrMsg('该区域已不存在，无法保存。请返回首页重新选择区域。');
      setAreaState('not-found');
      return;
    }

    setBusy(true);
    setErrMsg(null);
    try {
      for (const b of blobs) {
        await PhotoRepo.create({ type: 'area', id: areaId }, b.blob);
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
        <p className="text-danger-text">⚠️ 找不到该区域（可能已被删除）。</p>
        <Link to="/" className="text-accent hover:text-accent-hover text-sm">← 返回首页</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-ink-muted">
        <Link to={`/areas/${areaId}`} className="hover:text-ink">← 返回 {area!.name}</Link>
      </div>
      <h1 className="text-xl font-semibold">📷 拍照存档 · {area!.name}</h1>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        onChange={onPick}
        className="hidden"
      />

      <button
        onClick={() => fileRef.current?.click()}
        className="w-full h-11 flex items-center justify-center rounded-[12px] bg-paper-card border border-[var(--border-default)] hover:border-accent/40 text-ink font-medium text-sm transition-all duration-150"
      >
        📷 拍照（可多张）
      </button>

      {errMsg && <p className="text-danger-text text-sm">{errMsg}</p>}

      {blobs.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink-muted mb-2">已选 {blobs.length} 张</h2>
          <div className="grid grid-cols-3 gap-2">
            {blobs.map((b, i) => (
              <div key={i} className="relative">
                <img src={b.url} className="w-full aspect-square object-cover rounded-lg" />
                <button
                  onClick={() => removeBlob(i)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center"
                  aria-label="删除"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {blobs.length > 0 && (
        <button
          onClick={save}
          disabled={busy}
          className="w-full h-11 flex items-center justify-center rounded-[12px] bg-accent hover:bg-accent-hover active:scale-[0.98] text-paper font-medium text-sm shadow-card transition-all duration-150 disabled:opacity-50"
        >
          {busy ? '保存中…' : `存档 ${blobs.length} 张照片`}
        </button>
      )}
    </div>
  );
}
