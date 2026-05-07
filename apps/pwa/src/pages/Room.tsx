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
    <div className="space-y-5">
      {dialog}
      <div className="text-sm text-slate-400">
        <Link to="/" className="hover:text-white">← 房间</Link>
      </div>
      <h1 className="text-2xl font-semibold">{room.name}</h1>

      <section>
        <h2 className="text-base font-semibold mb-2">添加区域</h2>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(name); }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="区域名（如 洗手台柜子）"
            className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-sky-500"
          />
          <button className="shrink-0 px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-medium">添加</button>
        </form>
        <div className="mt-2 flex flex-wrap gap-2">
          {AREA_PRESETS.map(p => (
            <button
              key={p}
              onClick={() => add(p)}
              className="text-xs px-2.5 py-1.5 rounded-full bg-slate-800 border border-slate-700 hover:border-sky-500"
            >
              + {p}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold mb-2">区域 ({areas.length})</h2>
        {areas.length === 0 ? (
          <p className="text-slate-400 text-sm">这个房间还没有区域。</p>
        ) : (
          <ul className="space-y-2">
            {areas.map(a => (
              <li key={a.id} className="flex items-center gap-2">
                <Link
                  to={`/areas/${a.id}`}
                  className="flex-1 block px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 hover:border-sky-500"
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
                  className="px-3 py-2 text-sm rounded-lg border border-slate-700 text-rose-300 hover:border-rose-500"
                  aria-label={`删除区域 ${a.name}`}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
