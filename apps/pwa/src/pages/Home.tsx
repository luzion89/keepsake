import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Room } from '@keepsake/shared';
import { AreaRepo, ItemRepo, RoomRepo } from '../db/repos.js';
import { useConfirm } from '../components/ConfirmDialog.js';

const PRESETS = ['厨房', '客厅', '阳台', '主卧', '次卧', '卫生间', '储物间', '玄关'];

export function HomePage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState('');
  const { confirm, dialog } = useConfirm();

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
    <div className="space-y-6">
      {dialog}

      {/* ── 添加房间表单 ──────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">添加房间</h2>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(name); }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="房间名（如 厨房）"
            className="flex-1 min-w-0 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 transition-all duration-150"
          />
          <button className="shrink-0 px-4 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-[0.97] text-white font-medium text-sm shadow-lg shadow-sky-500/20 transition-all duration-150">
            添加
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map(p => (
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

      {/* ── 房间列表 ──────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
          我的房间 {rooms.length > 0 && `(${rooms.length})`}
        </h2>
        {rooms.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <span className="text-4xl mb-3">🏠</span>
            <p className="text-slate-400 text-sm font-medium">还没有房间</p>
            <p className="text-slate-500 text-xs mt-1">点上面的预设或输入自定义名称添加</p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {rooms.map(r => (
              <li key={r.id} className="relative group">
                <Link
                  to={`/rooms/${r.id}`}
                  className="block aspect-square rounded-2xl bg-slate-900 border border-slate-800 hover:border-sky-500/40 hover:bg-slate-800/80 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] p-4 flex flex-col transition-all duration-150"
                >
                  <span className="text-base font-semibold text-slate-100 pr-8">{r.name}</span>
                  <span className="mt-auto text-xs text-slate-600">→</span>
                </Link>
                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    const areas = await AreaRepo.listByRoom(r.id);
                    let itemCount = 0;
                    for (const a of areas) itemCount += (await ItemRepo.listByArea(a.id)).length;
                    const message = areas.length === 0
                      ? `删除房间「${r.name}」？`
                      : `「${r.name}」下有 ${areas.length} 个区域、${itemCount} 个物品，将一并软删除。继续？`;
                    const ok = await confirm(message, { danger: true, okText: '删除' });
                    if (!ok) return;
                    for (const a of areas) {
                      for (const it of await ItemRepo.listByArea(a.id)) await ItemRepo.remove(it.id);
                      await AreaRepo.remove(a.id);
                    }
                    await RoomRepo.remove(r.id);
                    await reload();
                  }}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-slate-800 text-rose-400 text-xs opacity-0 group-hover:opacity-100 hover:bg-rose-950 transition-all duration-150 flex items-center justify-center"
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
