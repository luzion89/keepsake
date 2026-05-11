import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home as HomeIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Area, Room } from '@keepsake/shared';
import { AreaRepo, ItemRepo, RoomRepo } from '../db/repos.js';
import { useConfirm } from '../components/ConfirmDialog.js';

const PRESETS = ['厨房', '客厅', '阳台', '主卧', '次卧', '卫生间', '储物间', '玄关'];

interface RoomMeta { room: Room; areaCount: number }

export function HomePage() {
  const [metas, setMetas] = useState<RoomMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [fabOpen, setFabOpen] = useState(false);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useConfirm();
  const navigate = useNavigate();

  const reload = async () => {
    const rooms = await RoomRepo.list();
    const result: RoomMeta[] = await Promise.all(
      rooms.map(async r => {
        const areas = await AreaRepo.listByRoom(r.id);
        return { room: r, areaCount: areas.length };
      })
    );
    setMetas(result);
    setLoading(false);
  };
  useEffect(() => { reload(); }, []);

  const add = async (n: string) => {
    const trimmed = n.trim();
    if (!trimmed) return;
    await RoomRepo.create({ name: trimmed });
    setName('');
    setFabOpen(false);
    await reload();
  };

  const startRename = (r: Room) => {
    setEditingId(r.id);
    setEditName(r.name);
    setTimeout(() => editRef.current?.focus(), 50);
  };

  const commitRename = async (id: string) => {
    const trimmed = editName.trim();
    if (trimmed) await RoomRepo.update(id, { name: trimmed });
    setEditingId(null);
    await reload();
  };

  const deleteRoom = async (r: Room) => {
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
    setSwipedId(null);
    await reload();
  };

  // Close swipe when clicking elsewhere
  useEffect(() => {
    const close = () => setSwipedId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  return (
    <div className="space-y-4">
      {dialog}

      {/* ── 页面标题 (#190 #191) ─────────────────────── */}
      <h1 className="text-2xl font-bold font-serif text-ink flex items-center gap-2">
        <HomeIcon size={22} strokeWidth={1.5} />
        房间
      </h1>

      {/* ── 房间列表 ──────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">
          我的房间 {metas.length > 0 && `(${metas.length})`}
        </h2>
        {loading ? (
          <div className="flex flex-col items-center py-12 text-center">
            <p className="text-ink-muted text-sm">加载中…</p>
          </div>
        ) : metas.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <HomeIcon size={40} strokeWidth={1.5} className="text-ink-muted/40 mb-3" />
            <p className="text-ink-muted text-sm font-medium">还没有房间</p>
            <p className="text-ink-muted/70 text-xs mt-1">点右下角 + 添加第一个房间</p>
          </div>
        ) : (
          <ul className="bg-paper-card border border-[var(--border-default)] rounded-[12px] overflow-hidden divide-y divide-[var(--border-subtle)]">
            {metas.map(({ room: r, areaCount }) => (
              <li
                key={r.id}
                className="relative overflow-hidden"
                onClick={(e) => {
                  // 如已展开滑动状态，点击空白只收起（点删除按钮除外）
                  if (swipedId === r.id && !(e.target as HTMLElement).closest('[data-delete]')) {
                    e.preventDefault();
                    e.stopPropagation();
                    setSwipedId(null);
                    return;
                  }
                  // 编辑态不跳转
                  if (editingId === r.id) return;
                  // 按钮区不跳转（Pencil/Delete 按钮有 stopPropagation，此处兜底）
                  if ((e.target as HTMLElement).closest('button')) return;
                  navigate(`/rooms/${r.id}`);
                }}
              >
                {/* Delete background */}
                <div className="absolute inset-y-0 right-0 flex items-center bg-danger px-5 select-none" aria-hidden="true">
                  <Trash2 size={18} strokeWidth={1.5} className="text-paper" />
                  <span className="text-paper text-sm ml-1.5">删除</span>
                </div>

                {/* Swipeable row */}
                <div
                  className="relative flex items-center px-4 min-h-[52px] bg-paper-card transition-transform duration-200 ease-out"
                  style={{ transform: swipedId === r.id ? 'translateX(-88px)' : 'translateX(0)', touchAction: 'pan-y' }}
                  onTouchStart={(e) => { touchStartX.current = e.touches[0]!.clientX; }}
                  onTouchEnd={(e) => {
                    if (touchStartX.current === null) return;
                    const delta = e.changedTouches[0]!.clientX - touchStartX.current;
                    touchStartX.current = null;
                    if (delta < -40) { e.stopPropagation(); setSwipedId(r.id); }
                    else if (delta > 10) setSwipedId(null);
                  }}
                >
                  <HomeIcon size={18} strokeWidth={1.5} className="text-ink-muted mr-3 shrink-0" />
                  {editingId === r.id ? (
                    <input
                      ref={editRef}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => commitRename(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(r.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="flex-1 bg-paper-dark border border-accent rounded-[8px] px-2 py-1 text-sm outline-none text-ink"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="flex-1 min-w-0 flex items-center gap-0">
                      <span className="min-w-0 text-sm font-medium text-ink truncate">
                        {r.name}
                      </span>
                      {/* #192: 改名图标紧贴名称右侧 */}
                      <button
                        onClick={(e) => { e.stopPropagation(); startRename(r); }}
                        className="ml-1.5 shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-paper-dark transition-all"
                        aria-label="改名"
                        title="改名"
                      >
                        <Pencil size={14} strokeWidth={1.5} />
                      </button>
                    </div>
                  )}
                  <span className="text-xs text-ink-muted">{areaCount} 个区域</span>
                </div>

                {/* Invisible delete tap target over the red area */}
                {swipedId === r.id && (
                  <button
                    data-delete="true"
                    className="absolute inset-y-0 right-0 w-[88px]"
                    onClick={(e) => { e.stopPropagation(); deleteRoom(r); }}
                    aria-label={`删除 ${r.name}`}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── FAB 添加房间 ──────────────────────────────── */}
      {fabOpen && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => setFabOpen(false)}
          aria-hidden="true"
        />
      )}
      <div
        className="fixed z-30 flex flex-col items-end"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)', right: '20px' }}
      >
        <button
          onClick={() => setFabOpen(v => !v)}
          className="w-14 h-14 rounded-full bg-accent hover:bg-accent-hover text-paper shadow-lg flex items-center justify-center transition-all duration-300 active:scale-[0.95]"
          aria-label={fabOpen ? '关闭' : '添加房间'}
        >
          <span
            className="transition-transform duration-300"
            style={{ transform: fabOpen ? 'rotate(45deg)' : 'rotate(0deg)' }}
          >
            <Plus size={24} strokeWidth={1.5} />
          </span>
        </button>
        <div
          className="overflow-hidden transition-all duration-300 ease-out"
          style={{
            maxHeight: fabOpen ? '320px' : '0px',
            opacity: fabOpen ? 1 : 0,
            marginTop: fabOpen ? '12px' : '0px',
          }}
        >
          <div className="bg-paper-card border border-[var(--border-default)] rounded-[12px] shadow-lg p-3 space-y-2 w-64">
            <p className="text-xs font-medium text-ink-muted">添加房间</p>
            <form onSubmit={(e) => { e.preventDefault(); add(name); }} className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="房间名（如 厨房）"
                className="flex-1 min-w-0 bg-paper-dark border border-[var(--border-default)] rounded-[12px] px-3 py-2 text-sm outline-none focus:border-accent text-ink placeholder:text-ink-muted"
              />
              <button className="shrink-0 px-3 py-2 rounded-[12px] bg-accent hover:bg-accent-hover text-paper text-sm font-medium transition-all">
                添加
              </button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => add(p)}
                  className="text-xs px-2.5 py-1.5 rounded-full bg-paper-dark border border-[var(--border-default)] hover:border-accent/50 text-ink-muted transition-all"
                >
                  + {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
