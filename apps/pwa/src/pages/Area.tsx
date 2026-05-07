import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Area, Item, Room } from '@keepsake/shared';
import { AreaRepo, ItemRepo, RoomRepo } from '../db/repos.js';

export function AreaPage() {
  const { areaId = '' } = useParams();
  const [area, setArea] = useState<Area | undefined>();
  const [room, setRoom] = useState<Room | undefined>();
  const [items, setItems] = useState<Item[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);

  const reload = async () => {
    const a = await AreaRepo.get(areaId);
    setArea(a);
    if (a) setRoom(await RoomRepo.get(a.room_id));
    setItems(await ItemRepo.listByArea(areaId));
  };
  useEffect(() => { reload(); }, [areaId]);

  const add = async () => {
    if (!name.trim()) return;
    await ItemRepo.create({ area_id: areaId, name: name.trim(), qty });
    setName(''); setQty(1);
    await reload();
  };

  if (!area) return <p className="text-slate-400">加载中…</p>;

  return (
    <div className="space-y-5">
      <div className="text-sm text-slate-400">
        <Link to="/" className="hover:text-white">房间</Link>
        {room && <> / <Link to={`/rooms/${room.id}`} className="hover:text-white">{room.name}</Link></>}
      </div>
      <h1 className="text-2xl font-semibold">{area.name}</h1>

      {/* 主入口：拍照 + 语音 */}
      <section className="grid grid-cols-2 gap-3">
        <Link
          to={`/areas/${area.id}/capture`}
          className="px-4 py-4 rounded-xl bg-emerald-500 text-slate-950 font-medium text-center"
        >
          📷 拍照识别
        </Link>
        <Link
          to={`/areas/${area.id}/voice`}
          className="px-4 py-4 rounded-xl bg-sky-500 text-slate-950 font-medium text-center"
        >
          🎤 语音输入
        </Link>
      </section>

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
          <p className="text-slate-400 text-sm">这个区域还没有物品。点上面的「📷 拍照识别」或「🎤 语音输入」开始。</p>
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
                    if (!confirm(`删除物品「${it.name}」？`)) return;
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
