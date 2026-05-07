import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Area, Item, Photo, Room } from '@keepsake/shared';
import { AreaRepo, ItemRepo, PhotoRepo, RoomRepo } from '../db/repos.js';
import { useConfirm } from '../components/ConfirmDialog.js';

type AreaState = 'loading' | 'not-found' | 'ok';

export function AreaPage() {
  const { areaId = '' } = useParams();
  const [areaState, setAreaState] = useState<AreaState>('loading');
  const [area, setArea] = useState<Area | undefined>();
  const [room, setRoom] = useState<Room | undefined>();
  const [items, setItems] = useState<Item[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoBlobUrls, setPhotoBlobUrls] = useState<Record<string, string>>({});
  const [showManual, setShowManual] = useState(false);
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);
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
    // resolve blob_ref → object URLs for local photos
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
    <div className="space-y-6">
      {dialog}

      {/* ── 面包屑 ────────────────────────────────────── */}
      <nav className="flex items-center gap-1 text-xs text-slate-500">
        <Link to="/" className="hover:text-slate-300 transition-colors">房间</Link>
        <span className="text-slate-700">›</span>
        {room && (
          <>
            <Link to={`/rooms/${room.id}`} className="hover:text-slate-300 transition-colors">{room.name}</Link>
            <span className="text-slate-700">›</span>
          </>
        )}
        <span className="text-slate-300">{area.name}</span>
      </nav>

      <h1 className="text-2xl font-bold text-slate-100">{area.name}</h1>

      {/* ── 主 CTA 按钮区 ─────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Link
          to={`/areas/${area.id}/text`}
          className="w-full py-4 rounded-2xl bg-sky-500 hover:bg-sky-400 active:scale-[0.98] text-white font-semibold text-base text-center shadow-lg shadow-sky-500/20 transition-all duration-150"
        >
          📝 录入物品
        </Link>
        <Link
          to={`/areas/${area.id}/capture`}
          className="w-full py-3 rounded-2xl bg-slate-900 border border-slate-800 hover:border-sky-500/40 text-slate-100 font-medium text-center transition-all duration-150"
        >
          📷 区域照片
        </Link>
      </section>

      {/* ── 区域照片缩略图 ────────────────────────────── */}
      {photos.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">已拍照片 ({photos.length})</h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.map(p => {
              const src = photoBlobUrls[p.id];
              return src ? (
                <img
                  key={p.id}
                  src={src}
                  alt="区域照片"
                  className="h-20 w-20 object-cover rounded-xl flex-shrink-0 border border-slate-800"
                />
              ) : (
                <div key={p.id} className="h-20 w-20 rounded-xl flex-shrink-0 bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 text-xs">
                  📷
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 手动添加（折叠） ──────────────────────────── */}
      <section>
        <button
          onClick={() => setShowManual(s => !s)}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          <span className={`inline-block transition-transform duration-150 ${showManual ? 'rotate-90' : ''}`}>›</span>
          手动添加单个物品
        </button>
        {showManual && (
          <div className="mt-2 bg-slate-900 border border-slate-800 rounded-xl p-3">
            <div className="flex flex-wrap gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="物品名"
                className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 transition-all"
              />
              <input
                type="number"
                value={qty}
                min={0}
                onChange={(e) => setQty(Number(e.target.value))}
                className="w-20 shrink-0 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm outline-none focus:border-sky-400 transition-all"
              />
              <button onClick={add} className="shrink-0 px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-100 font-medium text-sm transition-all">
                添加
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── 物品列表 ──────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
          物品 {items.length > 0 && `(${items.length})`}
        </h2>
        {items.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <span className="text-4xl mb-3">📦</span>
            <p className="text-slate-400 text-sm">这个区域还没有物品</p>
            <p className="text-slate-500 text-xs mt-1">点上面的「📝 录入物品」开始</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map(it => (
              <li key={it.id} className="flex items-center gap-3 px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
                <Link to={`/items/${it.id}`} className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-100 truncate">{it.name}</div>
                  <div className="text-xs text-slate-500">
                    {it.source !== 'manual' && <span className="mr-1">{it.source}</span>}
                    {it.confidence != null && <span>{(it.confidence * 100).toFixed(0)}%</span>}
                  </div>
                </Link>
                <button
                  onClick={() => ItemRepo.qtyDelta(it.id, -1).then(reload)}
                  className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 text-slate-300 hover:border-sky-500 text-sm flex items-center justify-center transition-all"
                  aria-label="减少数量"
                >−</button>
                <span className="text-sm font-medium w-5 text-center text-slate-100">{it.qty}</span>
                <button
                  onClick={() => ItemRepo.qtyDelta(it.id, +1).then(reload)}
                  className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 text-slate-300 hover:border-sky-500 text-sm flex items-center justify-center transition-all"
                  aria-label="增加数量"
                >+</button>
                <button
                  onClick={async () => {
                    const ok = await confirm(`删除物品「${it.name}」？`, { danger: true, okText: '删除' });
                    if (!ok) return;
                    await ItemRepo.remove(it.id);
                    await reload();
                  }}
                  className="text-slate-600 hover:text-rose-400 text-lg leading-none transition-colors"
                  aria-label={`删除 ${it.name}`}
                >×</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
