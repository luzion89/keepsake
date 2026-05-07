import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Room } from '@keepsake/shared';
import { AreaRepo, ItemRepo, RoomRepo } from '../db/repos.js';

const PRESETS = ['厨房', '客厅', '阳台', '主卧', '次卧', '卫生间', '储物间', '玄关'];

export function HomePage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState('');

  const reload = async () => setRooms(await RoomRepo.list());
  useEffect(() => { reload(); }, []);

  const add = async (n: string) => {
    const trimmed = n.trim();
    if (!trimmed) return;
    await RoomRepo.create({ name: trimmed });
    setName('');
    await reload();
  };

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-xl font-semibold mb-3">添加房间</h1>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(name); }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="房间名（如 厨房）"
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-sky-500"
          />
          <button className="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-medium">添加</button>
        </form>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map(p => (
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
        <h2 className="text-lg font-semibold mb-2">我的房间 ({rooms.length})</h2>
        {rooms.length === 0 ? (
          <p className="text-slate-400 text-sm">还没有房间。点上面的预设或输入自定义名称添加。</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {rooms.map(r => (
              <li key={r.id} className="relative">
                <Link
                  to={`/rooms/${r.id}`}
                  className="block aspect-square rounded-2xl bg-slate-800 border border-slate-700 hover:border-sky-500 p-4 flex flex-col"
                >
                  <span className="text-base font-medium pr-8">{r.name}</span>
                  <span className="mt-auto text-xs text-slate-400">查看 →</span>
                </Link>
                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    const areas = await AreaRepo.listByRoom(r.id);
                    let itemCount = 0;
                    for (const a of areas) itemCount += (await ItemRepo.listByArea(a.id)).length;
                    const ok = areas.length === 0
                      ? confirm(`删除房间「${r.name}」？`)
                      : confirm(`「${r.name}」下有 ${areas.length} 个区域、${itemCount} 个物品，将一并软删除。继续？`);
                    if (!ok) return;
                    for (const a of areas) {
                      for (const it of await ItemRepo.listByArea(a.id)) await ItemRepo.remove(it.id);
                      await AreaRepo.remove(a.id);
                    }
                    await RoomRepo.remove(r.id);
                    await reload();
                  }}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-slate-900/70 border border-slate-700 text-rose-300 text-xs hover:border-rose-500"
                  aria-label={`删除房间 ${r.name}`}
                  title="删除房间"
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
