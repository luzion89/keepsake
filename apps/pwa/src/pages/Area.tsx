import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle, Camera, ChevronLeft, ChevronRight, Download,
  FileText, MoreHorizontal, Package, Pencil, Trash2, X,
} from 'lucide-react';
import type { Area, Item, Photo, Room } from '@keepsake/shared';
import { AreaRepo, ItemRepo, PhotoRepo, RoomRepo } from '../db/repos.js';
import { useConfirm } from '../components/ConfirmDialog.js';

type AreaState = 'loading' | 'not-found' | 'ok';

function DotMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (
        !btnRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen(v => !v);
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-ink-muted hover:text-ink transition-colors"
        aria-label="更多操作"
      >
        <MoreHorizontal size={18} strokeWidth={1.5} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999 }}
          className="bg-paper-card border border-[var(--border-default)] rounded-[12px] shadow-lg overflow-hidden min-w-[120px]"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>,
        document.body
      )}
    </div>
  );
}

export function AreaPage() {
  const { areaId = '' } = useParams();
  const [areaState, setAreaState] = useState<AreaState>('loading');
  const [area, setArea] = useState<Area | undefined>();
  const [room, setRoom] = useState<Room | undefined>();
  const [items, setItems] = useState<Item[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoBlobUrls, setPhotoBlobUrls] = useState<Record<string, string>>({});
  const [showManual, setShowManual] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemName, setEditItemName] = useState('');
  const [lightbox, setLightbox] = useState<{ src: string; photoId: string; index: number } | null>(null);
  const [slideDir, setSlideDir] = useState<'left' | 'right' | 'none'>('none');
  const [slideKey, setSlideKey] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const editItemRef = useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useConfirm();

  const reload = async () => {
    const a = await AreaRepo.get(areaId);
    if (a) {
      setArea(a);
      setAreaState('ok');
      setRoom(await RoomRepo.get(a.room_id));
    } else {
      setAreaState('not-found');
    }
    setItems(await ItemRepo.listByArea(areaId));
    const ps = await PhotoRepo.listFor('area', areaId);
    setPhotos(ps);
    const urls: Record<string, string> = {};
    await Promise.all(ps.map(async (p) => {
      if (p.remote_url) {
        urls[p.id] = p.remote_url;
      } else if (p.blob_ref) {
        const blob = await PhotoRepo.getBlob(p.blob_ref);
        if (blob) urls[p.id] = URL.createObjectURL(blob);
      }
    }));
    setPhotoBlobUrls(urls);
  };
  useEffect(() => {
    if (!areaId) { setAreaState('not-found'); return; }
    reload();
  }, [areaId]);

  const add = async () => {
    if (!name.trim()) return;
    await ItemRepo.create({ area_id: areaId, name: name.trim(), qty });
    setName(''); setQty(1);
    await reload();
  };

  const startRenameItem = (it: Item) => {
    setEditingItemId(it.id);
    setEditItemName(it.name);
    setTimeout(() => editItemRef.current?.focus(), 50);
  };

  const commitRenameItem = async (id: string) => {
    const trimmed = editItemName.trim();
    if (trimmed) await ItemRepo.update(id, { name: trimmed });
    setEditingItemId(null);
    await reload();
  };

  if (areaState === 'loading') return <p className="text-ink-muted">加载中…</p>;
  if (areaState === 'not-found') {
    return (
      <div className="space-y-3">
        <p className="text-danger-text flex items-center gap-1.5">
          <AlertTriangle size={14} strokeWidth={1.5} className="shrink-0" />
          找不到该区域（可能已被删除）。
        </p>
        <Link to="/" className="text-accent hover:text-accent-hover text-sm flex items-center gap-1">
          <ChevronLeft size={14} strokeWidth={1.5} />
          返回首页
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {dialog}

      {/* ── 面包屑兼标题 ──────────────────────────────── */}
      <nav className="flex items-center gap-1 text-xl font-bold font-serif text-ink flex-wrap">
        <Link to="/" className="text-ink-muted hover:text-ink transition-colors text-sm font-normal font-sans">房间</Link>
        <span className="text-ink-faint text-sm font-normal mx-1">›</span>
        {room && (
          <>
            <Link to={`/rooms/${room.id}`} className="text-ink-muted hover:text-ink transition-colors text-sm font-normal font-sans">{room.name}</Link>
            <span className="text-ink-faint text-sm font-normal mx-1">›</span>
          </>
        )}
        <span>{area!.name}</span>
      </nav>

      {/* ── 紧凑 CTA 行 ───────────────────────────────── */}
      <div className="flex gap-2">
        <Link
          to={`/areas/${area!.id}/text`}
          className="flex-1 h-10 flex items-center justify-center gap-1.5 rounded-[12px] bg-accent hover:bg-accent-hover active:scale-[0.98] text-paper font-medium text-sm shadow-card transition-all duration-150"
        >
          <FileText size={16} strokeWidth={1.5} />
          录入物品
        </Link>
        <Link
          to={`/areas/${area!.id}/capture`}
          className="flex-1 h-10 flex items-center justify-center gap-1.5 rounded-[12px] bg-paper-card border border-[var(--border-default)] hover:border-accent/40 text-ink font-medium text-sm transition-all duration-150"
        >
          <Camera size={16} strokeWidth={1.5} />
          区域照片
        </Link>
      </div>

      {/* ── 手动添加（折叠） ──────────────────────────── */}
      <section>
        <button
          onClick={() => setShowManual(s => !s)}
          className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink transition-colors"
        >
          <span className={`inline-block transition-transform duration-150 ${showManual ? 'rotate-90' : ''}`}>›</span>
          手动添加单个物品
        </button>
        {showManual && (
          <div className="mt-2 bg-paper-card border border-[var(--border-default)] rounded-[12px] p-3">
            <div className="flex flex-wrap gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="物品名"
                className="flex-1 min-w-0 bg-paper-dark border border-[var(--border-default)] rounded-[12px] px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all text-ink placeholder:text-ink-muted"
              />
              <input
                type="number"
                value={qty}
                min={0}
                onChange={(e) => setQty(Number(e.target.value))}
                className="w-20 shrink-0 bg-paper-dark border border-[var(--border-default)] rounded-[12px] px-3 py-2 text-sm outline-none focus:border-accent transition-all text-ink"
              />
              <button onClick={add} className="shrink-0 px-4 py-2 rounded-[12px] bg-paper-dark border border-[var(--border-default)] hover:border-accent text-ink font-medium text-sm transition-all">
                添加
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── 物品列表 ──────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">
          物品 {items.length > 0 && `(${items.length})`}
        </h2>
        {items.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <Package size={40} strokeWidth={1.5} className="text-ink-muted/40 mb-3" />
            <p className="text-ink-muted text-sm">这个区域还没有物品</p>
            <p className="text-ink-muted/70 text-xs mt-1">点上面的「录入物品」开始</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {items.map(it => (
              <li key={it.id} className="flex items-center gap-2 px-3 py-1.5 bg-paper-card border border-[var(--border-default)] rounded-[12px] shadow-card">
                <Link to={`/items/${it.id}`} className="flex-1 min-w-0">
                  {editingItemId === it.id ? (
                    <input
                      ref={editItemRef}
                      value={editItemName}
                      onChange={(e) => setEditItemName(e.target.value)}
                      onBlur={() => commitRenameItem(it.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRenameItem(it.id);
                        if (e.key === 'Escape') setEditingItemId(null);
                      }}
                      className="w-full bg-paper-dark border border-accent rounded-[8px] px-2 py-1 text-sm outline-none text-ink"
                      onClick={(e) => e.preventDefault()}
                    />
                  ) : (
                    <div className="text-sm font-medium text-ink truncate">{it.name}</div>
                  )}
                  <div className="text-xs text-ink-muted">
                    {it.source !== 'manual' && <span className="mr-1">{it.source}</span>}
                    {it.confidence != null && <span>{(it.confidence * 100).toFixed(0)}%</span>}
                  </div>
                </Link>
                <button
                  onClick={() => ItemRepo.qtyDelta(it.id, -1).then(reload)}
                  className="min-w-[44px] min-h-[44px] rounded-full bg-paper-dark border border-[var(--border-default)] text-ink hover:border-accent text-sm flex items-center justify-center transition-all"
                  aria-label="减少数量"
                >−</button>
                <span className="text-sm font-medium w-5 text-center text-ink">{it.qty}</span>
                <button
                  onClick={() => ItemRepo.qtyDelta(it.id, +1).then(reload)}
                  className="min-w-[44px] min-h-[44px] rounded-full bg-paper-dark border border-[var(--border-default)] text-ink hover:border-accent text-sm flex items-center justify-center transition-all"
                  aria-label="增加数量"
                >+</button>
                <DotMenu>
                  <button
                    className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-paper-dark transition-colors flex items-center gap-2"
                    onClick={() => startRenameItem(it)}
                  >
                    <Pencil size={14} strokeWidth={1.5} />
                    改名
                  </button>
                  <button
                    className="w-full text-left px-4 py-2.5 text-sm text-danger-text hover:bg-danger-bg transition-colors flex items-center gap-2"
                    onClick={async () => {
                      const ok = await confirm(`删除物品「${it.name}」？`, { danger: true, okText: '删除' });
                      if (!ok) return;
                      await ItemRepo.remove(it.id);
                      await reload();
                    }}
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                    删除
                  </button>
                </DotMenu>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 区域照片时间线 ──────────────────────────── */}
      {photos.length > 0 && (
        <section>
          <button
            onClick={() => setShowPhotos(v => !v)}
            className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink transition-colors mb-2"
          >
            <span className={`inline-block transition-transform duration-150 ${showPhotos ? 'rotate-90' : ''}`}>›</span>
            已拍照片 ({photos.length})
          </button>
          {showPhotos && (() => {
            // 按月分组
            const grouped = new Map<string, typeof photos>();
            for (const p of [...photos].sort((a, b) => b.taken_at - a.taken_at)) {
              const d = new Date(p.taken_at);
              const key = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
              if (!grouped.has(key)) grouped.set(key, []);
              grouped.get(key)!.push(p);
            }
            return (
              <div className="space-y-4">
                {Array.from(grouped.entries()).map(([month, ps]) => (
                  <div key={month}>
                    <p className="text-xs text-ink-muted mb-2">{month}</p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {ps.map(p => {
                        const src = photoBlobUrls[p.id];
                        const _d = new Date(p.taken_at);
                        const dateStr = `${_d.getMonth() + 1}月${_d.getDate()}日`;
                        return (
                          <div key={p.id} className="flex-shrink-0 relative group/photo">
                            {src ? (
                              <img
                                src={src}
                                alt={`区域照片 ${dateStr}`}
                                onClick={() => {
                                  const sortedAll = [...photos].sort((a, b) => b.taken_at - a.taken_at);
                                  const idx = sortedAll.findIndex(x => x.id === p.id);
                                  setLightbox({ src, photoId: p.id, index: idx });
                                }}
                                className="h-20 w-20 object-cover rounded-[12px] border border-[var(--border-default)] cursor-pointer active:scale-95 transition-transform"
                              />
                            ) : (
                              <div className="h-20 w-20 rounded-[12px] bg-paper-dark border border-[var(--border-default)] flex items-center justify-center text-ink-muted">
                                <Camera size={20} strokeWidth={1.5} />
                              </div>
                            )}
                            <span className="absolute bottom-1 left-0 right-0 text-center text-[10px] text-paper/80 drop-shadow-sm pointer-events-none">
                              {dateStr}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </section>
      )}

      {/* ── 照片灯箱 ────────────────────────────────── */}
      {lightbox && (() => {
        const sortedPhotos = [...photos].sort((a, b) => b.taken_at - a.taken_at);
        const currentIdx = lightbox.index;
        const total = sortedPhotos.length;
        const currentPhoto = sortedPhotos[currentIdx];
        const fullDateStr = currentPhoto
          ? new Date(currentPhoto.taken_at).toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '';

        const goNext = () => {
          const nextIdx = (currentIdx + 1) % total;
          const np = sortedPhotos[nextIdx];
          if (!np) return;
          const src = photoBlobUrls[np.id];
          if (src) { setSlideDir('left'); setSlideKey(k => k + 1); setLightbox({ src, photoId: np.id, index: nextIdx }); }
        };
        const goPrev = () => {
          const prevIdx = (currentIdx - 1 + total) % total;
          const pp = sortedPhotos[prevIdx];
          if (!pp) return;
          const src = photoBlobUrls[pp.id];
          if (src) { setSlideDir('right'); setSlideKey(k => k + 1); setLightbox({ src, photoId: pp.id, index: prevIdx }); }
        };

        return (
          <div
            className="fixed inset-0 z-50 flex flex-col bg-black/90"
            onClick={(e) => { if (e.target === e.currentTarget) setLightbox(null); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') goPrev();
              if (e.key === 'ArrowRight') goNext();
              if (e.key === 'Escape') setLightbox(null);
            }}
            tabIndex={-1}
            ref={(el) => el?.focus()}
          >
            {/* 顶部工具栏 */}
            <div className="flex items-center justify-between px-4 py-3 shrink-0">
              {/* 关闭 */}
              <button
                onClick={() => setLightbox(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-white/80 hover:text-white transition-colors"
                aria-label="关闭"
              >
                <X size={22} strokeWidth={1.5} />
              </button>
              {/* 日期 + 页码 */}
              <span className="text-white/60 text-xs text-center leading-tight">
                <span className="block">{fullDateStr}</span>
                {total > 1 && <span>{currentIdx + 1} / {total}</span>}
              </span>
              {/* 操作按钮 */}
              <div className="flex gap-1">
                <button
                  onClick={async () => {
                    const a = document.createElement('a');
                    a.href = lightbox.src;
                    a.download = `keepsake-photo-${Date.now()}.jpg`;
                    a.click();
                  }}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-white/80 hover:text-white transition-colors"
                  aria-label="下载照片"
                  title="下载"
                >
                  <Download size={20} strokeWidth={1.5} />
                </button>
                <button
                  onClick={async () => {
                    const ok = await confirm('删除这张照片？', { danger: true, okText: '删除' });
                    if (!ok) return;
                    await PhotoRepo.remove(lightbox.photoId);
                    setLightbox(null);
                    await reload();
                  }}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-white/80 hover:text-red-400 transition-colors"
                  aria-label="删除照片"
                  title="删除"
                >
                  <Trash2 size={20} strokeWidth={1.5} />
                </button>
              </div>
            </div>

            {/* 照片主区域（支持触摸滑动） */}
            <div
              className="flex-1 flex items-center justify-center overflow-hidden px-4 pb-4 relative"
              onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null; }}
              onTouchEnd={(e) => {
                if (touchStartX.current === null) return;
                const delta = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
                touchStartX.current = null;
                if (Math.abs(delta) < 50) return;
                if (delta < 0) goNext(); else goPrev();
              }}
            >
              <img
                key={slideKey}
                src={lightbox.src}
                alt="照片预览"
                className={`max-w-full max-h-full object-contain rounded-[8px] ${
                  slideDir === 'left'
                    ? 'animate-slide-in-left'
                    : slideDir === 'right'
                    ? 'animate-slide-in-right'
                    : ''
                }`}
              />
              {/* 左右箭头 (仅多张时显示) */}
              {total > 1 && (
                <>
                  <button
                    onClick={goPrev}
                    className="absolute left-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-black/30 text-white/80 hover:text-white hover:bg-black/50 transition-all"
                    aria-label="上一张"
                  >
                    <ChevronLeft size={20} strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={goNext}
                    className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-black/30 text-white/80 hover:text-white hover:bg-black/50 transition-all"
                    aria-label="下一张"
                  >
                    <ChevronRight size={20} strokeWidth={1.5} />
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
