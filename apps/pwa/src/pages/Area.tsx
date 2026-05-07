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
    <div className="space-y-5">
      {dialog}
      <div className="text-sm text-slate-400">
        <Link to="/" className="hover:text-white">房间</Link>
        {room && <> / <Link to={`/rooms/${room.id}`} className="hover:text-white">{room.name}</Link></>}
      </div>
      <h1 className="text-2xl font-semibold">{area.name}</h1>

      {/* 主入口：录入物品（主）+ 区域照片（次） */}
      <section className="flex flex-col gap-3">
        <Link
          to={`/areas/${area.id}/text`}
          className="px-4 py-4 rounded-xl bg-emerald-500 text-slate-950 font-semibold text-center text-lg"
        >
          📝 录入物品
        </Link>
        <Link
          to={`/areas/${area.id}/capture`}
          className="px-4 py-3 rounded-xl bg-slate-700 text-slate-100 font-medium text-center"
        >
          📷 区域照片
        </Link>
      </section>

      {/* 区域照片缩略图 */}
      {photos.length > 0 && (
        <section>
          <h2 className="text-sm text-slate-400 mb-2">已拍照片 ({photos.length})</h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.map(p => {
              const src = photoBlobUrls[p.id];
              return src ? (
                <img
                  key={p.id}
                  src={src}
                  alt="区域照片"
                  className="h-20 w-20 object-cover rounded-lg flex-shrink-0 border border-slate-700"
                />
              ) : (
                <div key={p.id} className="h-20 w-20 rounded-lg flex-shrink-0 bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 text-xs">
                  📷
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 兜底：手动添加（折叠） */}
      <section>
        <button
          onClick={() => setShowManual(s => !s)}
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          {showManual ? '▼' : '▶'} 手动添加（兜底，AI 识别失败时使用）
        </button>
        {showManual && (
          <div className="mt-2 bg-slate-800/60 border border-slate-700 rounded-xl p-3">
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="物品名"
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2"
              />
              <input
                type="number"
                value={qty}
                min={0}
                onChange={(e) => setQty(Number(e.target.value))}
                className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2"
              />
              <button onClick={add} className="px-4 py-2 rounded-lg bg-slate-700 text-slate-100 font-medium">
                添加
              </button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-base font-semibold mb-2">物品 ({items.length})</h2>
        {items.length === 0 ? (
          <p className="text-slate-400 text-sm">这个区域还没有物品。点上面的「📝 录入物品」开始。</p>
        ) : (
          <ul className="space-y-2">
            {items.map(it => (
              <li key={it.id} className="flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-800 border border-slate-700">
                <Link to={`/items/${it.id}`} className="flex-1">
                  <div className="font-medium">{it.name}</div>
                  <div className="text-xs text-slate-400">
                    数量 {it.qty}{it.unit ? ' ' + it.unit : ''}
                    {it.source !== 'manual' && <> · {it.source}</>}
                    {it.confidence != null && <> · {(it.confidence * 100).toFixed(0)}%</>}
                  </div>
                </Link>
                <button onClick={() => ItemRepo.qtyDelta(it.id, -1).then(reload)} className="px-2 py-1 bg-slate-700 rounded">−</button>
                <span className="w-6 text-center">{it.qty}</span>
                <button onClick={() => ItemRepo.qtyDelta(it.id, +1).then(reload)} className="px-2 py-1 bg-slate-700 rounded">+</button>
                <button
                  onClick={async () => {
                    const ok = await confirm(`删除物品「${it.name}」？`, { danger: true, okText: '删除' });
                    if (!ok) return;
                    await ItemRepo.remove(it.id);
                    await reload();
                  }}
                  className="px-2 py-1 text-rose-300 text-sm hover:text-rose-200"
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
