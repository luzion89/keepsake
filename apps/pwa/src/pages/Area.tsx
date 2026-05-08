import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Area, Item, Photo, Room } from '@keepsake/shared';
import { AreaRepo, ItemRepo, PhotoRepo, RoomRepo } from '../db/repos.js';
import { useConfirm } from '../components/ConfirmDialog.js';

type AreaState = 'loading' | 'not-found' | 'ok';

function DotMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(v => !v); }}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-ink-muted hover:text-ink transition-colors"
        aria-label="更多操作"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-paper-card border border-[var(--border-default)] rounded-[12px] shadow-lg overflow-hidden min-w-[120px]" onClick={() => setOpen(false)}>
          {children}
        </div>
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
        <p className="text-danger-text">⚠️ 找不到该区域（可能已被删除）。</p>
        <Link to="/" className="text-accent hover:text-accent-hover text-sm">← 返回首页</Link>
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
          📝 录入物品
        </Link>
        <Link
          to={`/areas/${area!.id}/capture`}
          className="flex-1 h-10 flex items-center justify-center gap-1.5 rounded-[12px] bg-paper-card border border-[var(--border-default)] hover:border-accent/40 text-ink font-medium text-sm transition-all duration-150"
        >
          📷 区域照片
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
            <span className="text-4xl mb-3">📦</span>
            <p className="text-ink-muted text-sm">这个区域还没有物品</p>
            <p className="text-ink-muted/70 text-xs mt-1">点上面的「📝 录入物品」开始</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map(it => (
              <li key={it.id} className="flex items-center gap-2 px-3 py-2.5 bg-paper-card border border-[var(--border-default)] rounded-[12px] shadow-card">
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
                    className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-paper-dark transition-colors"
                    onClick={() => startRenameItem(it)}
                  >
                    ✏️ 改名
                  </button>
                  <button
                    className="w-full text-left px-4 py-2.5 text-sm text-danger-text hover:bg-danger-bg transition-colors"
                    onClick={async () => {
                      const ok = await confirm(`删除物品「${it.name}」？`, { danger: true, okText: '删除' });
                      if (!ok) return;
                      await ItemRepo.remove(it.id);
                      await reload();
                    }}
                  >
                    🗑 删除
                  </button>
                </DotMenu>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 区域照片（可折叠，置底） ──────────────────── */}
      {photos.length > 0 && (
        <section>
          <button
            onClick={() => setShowPhotos(v => !v)}
            className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink transition-colors mb-2"
          >
            <span className={`inline-block transition-transform duration-150 ${showPhotos ? 'rotate-90' : ''}`}>›</span>
            已拍照片 ({photos.length})
          </button>
          {showPhotos && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {photos.map(p => {
                const src = photoBlobUrls[p.id];
                return src ? (
                  <img
                    key={p.id}
                    src={src}
                    alt="区域照片"
                    className="h-20 w-20 object-cover rounded-[12px] flex-shrink-0 border border-[var(--border-default)]"
                  />
                ) : (
                  <div key={p.id} className="h-20 w-20 rounded-[12px] flex-shrink-0 bg-paper-dark border border-[var(--border-default)] flex items-center justify-center text-ink-muted text-xs">
                    📷
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
