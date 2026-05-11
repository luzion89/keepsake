/**
 * Capture.tsx — 区域照片存档（#66）
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import imageCompression from 'browser-image-compression';
import { AlertTriangle, Camera, ChevronLeft, X } from 'lucide-react';
import { AreaRepo, PhotoRepo } from '../db/repos.js';
import type { Area } from '@keepsake/shared';
import { useT } from '../i18n/I18nContext.js';

type AreaState = 'loading' | 'not-found' | 'ok';

export function CapturePage() {
  const { t } = useT();
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
    if (!areaId || blobs.length === 0) return;
    const current = await AreaRepo.get(areaId);
    if (!current) {
      setErrMsg(t('area.notFound'));
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
      setErrMsg(e instanceof Error ? e.message : t('capture.errorCompress'));
    } finally {
      setBusy(false);
    }
  };

  if (areaState === 'loading') return <p className="text-ink-muted">{t('capture.loading')}</p>;
  if (areaState === 'not-found') {
    return (
      <div className="space-y-3">
        <p className="text-danger-text flex items-center gap-1.5">
          <AlertTriangle size={14} strokeWidth={1.5} className="shrink-0" />
          {t('capture.notFound')}
        </p>
        <Link to="/" className="text-accent hover:text-accent-hover text-sm flex items-center gap-1">
          <ChevronLeft size={14} strokeWidth={1.5} />
          {t('common.back')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-ink-muted">
        <Link to={`/areas/${areaId}`} className="hover:text-ink flex items-center gap-1">
          <ChevronLeft size={14} strokeWidth={1.5} />
          {t('common.back')} {area!.name}
        </Link>
      </div>
      <h1 className="text-xl font-semibold flex items-center gap-2">
        <Camera size={20} strokeWidth={1.5} className="text-ink-muted" />
        {t('capture.title')} · {area!.name}
      </h1>

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
        className="w-full h-11 flex items-center justify-center gap-2 rounded-[12px] bg-paper-card border border-[var(--border-default)] hover:border-accent/40 text-ink font-medium text-sm transition-all duration-150"
      >
        <Camera size={18} strokeWidth={1.5} />
        {t('capture.takePhoto')}
      </button>

      {errMsg && <p className="text-danger-text text-sm">{errMsg}</p>}

      {blobs.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink-muted mb-2">{t('capture.save', { n: blobs.length })}</h2>
          <div className="grid grid-cols-3 gap-2">
            {blobs.map((b, i) => (
              <div key={i} className="relative">
                <img src={b.url} className="w-full aspect-square object-cover rounded-lg" />
                <button
                  onClick={() => removeBlob(i)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                  aria-label={t('capture.remove')}
                >
                  <X size={12} strokeWidth={2} />
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
          {busy ? t('capture.saving') : t('capture.save', { n: blobs.length })}
        </button>
      )}
    </div>
  );
}
