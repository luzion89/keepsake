import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Room, Area } from '@keepsake/shared';
import { AreaRepo, ItemRepo, RoomRepo } from '../db/repos.js';
import { useConfirm } from '../components/ConfirmDialog.js';

const AREA_PRESETS = ['洗手台柜子', '墙壁柜', '电视柜', '沙发底下', '床底下', '吊柜', '抽屉', '工具箱'];

export function RoomPage() {
  const { roomId = '' } = useParams();
  const [room, setRoom] = useState<Room | undefined>();
  const [areas, setAreas] = useState<Area[]>([]);
  const [name, setName] = useState('');
  const { confirm, dialog } = useConfirm();

  const reload = async () => {
    setRoom(await RoomRepo.get(roomId));
    setAreas(await AreaRepo.listByRoom(roomId));
  };
  useEffect(() => { reload(); }, [roomId]);

  const add = async (n: string) => {
    const trimmed = n.trim();
    if (!trimmed) return;
    await AreaRepo.create({ room_id: roomId, name: trimmed });
    setName('');
    await reload();
  };

  if (!room) return <p className="text-slate-400">加载中…</p>;

  return (
    <div className="space-y-6">
      {dialog}

      {/* ── 面包屑 ────────────────────────────────────── */}
      <nav className="flex items-center gap-1 text-xs text-slate-500">
        <Link to="/" className="hover:text-slate-300 transition-colors">房间</Link>
        <span className="text-slate-700">›</span>
        <span className="text-slate-300">{room.name}</span>
      </nav>

      <h1 className="text-2xl font-bold text-slate-100">{room.name}</h1>

      {/* ── 添加区域表单 ──────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">添加区域</h2>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(name); }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="区域名（如 洗手台柜子）"
            className="flex-1 min-w-0 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 transition-all duration-150"
          />
          <button className="shrink-0 px-4 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-[0.97] text-white font-medium text-sm shadow-lg shadow-sky-500/20 transition-all duration-150">
            添加
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {AREA_PRESETS.map(p => (
            <button
              key={p}
              onClick={() => add(p)}
              className="text-xs px-3 py-1.5 rounded-full bg-slate-800 border border-slate-800 hover:border-sky-500/60 hover:bg-slate-700 text-slate-300 transition-all duration-150"
            >
              + {p}
            </button>
          ))}
        </div>
      </section>

      {/* ── 区域列表 ──────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
          区域 {areas.length > 0 && `(${areas.length})`}
        </h2>
        {areas.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <span className="text-4xl mb-3">📦</span>
            <p className="text-slate-400 text-sm">这个房间还没有区域</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {areas.map(a => (
              <li key={a.id} className="flex items-center px-4 py-3.5 bg-slate-900 border border-slate-800 rounded-2xl hover:border-sky-500/40 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] transition-all duration-150">
                <span className="text-base mr-3">📦</span>
                <Link
                  to={`/areas/${a.id}`}
                  className="flex-1 text-sm font-medium text-slate-100 hover:text-white"
                >
                  {a.name}
                </Link>
                <button
                  onClick={async () => {
                    const items = await ItemRepo.listByArea(a.id);
                    const message = items.length === 0
                      ? `删除区域「${a.name}」？`
                      : `「${a.name}」下还有 ${items.length} 个物品，将一并软删除。继续？`;
                    const ok = await confirm(message, { danger: true, okText: '删除' });
                    if (!ok) return;
                    for (const it of items) await ItemRepo.remove(it.id);
                    await AreaRepo.remove(a.id);
                    await reload();
                  }}
                  className="text-slate-600 hover:text-rose-400 text-lg leading-none transition-colors ml-2"
                  aria-label={`删除区域 ${a.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
