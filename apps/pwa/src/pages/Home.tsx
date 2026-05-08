import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Home as HomeIcon, MoreHorizontal, Package, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Area, Room } from '@keepsake/shared';
import { AreaRepo, ItemRepo, RoomRepo } from '../db/repos.js';
import { useConfirm } from '../components/ConfirmDialog.js';

const PRESETS = ['厨房', '客厅', '阳台', '主卧', '次卧', '卫生间', '储物间', '玄关'];

interface RoomMeta { room: Room; areaCount: number }

/** Three-dot dropdown menu — fixed 定位，自动向上/下翻转，避免被 overflow 裁剪 */
function DotMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { setOpen(false); };
    document.addEventListener('mousedown', close, { once: true });
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const menuH = 92;
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow >= menuH ? rect.bottom + 4 : rect.top - menuH - 4;
      setPos({ top, right: window.innerWidth - rect.right });
    }
    setOpen(v => !v);
  };
  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-ink-muted hover:text-ink transition-colors"
        aria-label="更多操作"
      >
        <MoreHorizontal size={18} strokeWidth={1.5} />
      </button>
      {open && pos && (
        <div
          className="fixed z-50 bg-paper-card border border-[var(--border-default)] rounded-[12px] shadow-lg overflow-hidden min-w-[120px]"
          style={{ top: pos.top, right: pos.right }}
          onMouseDown={e => e.stopPropagation()}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </>
  );
}

export function HomePage() {
  const [metas, setMetas] = useState<RoomMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [fabOpen, setFabOpen] = useState(false);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const editRef = useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useConfirm();

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
    await reload();
  };

  return (
    <div className="space-y-4">
      {dialog}

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
              <li key={r.id} className="flex items-center px-4 min-h-[52px]">
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
                  />
                ) : (
                  <Link
                    to={`/rooms/${r.id}`}
                    className="flex-1 font-serif text-base text-ink hover:text-ink-hover transition-colors"
                  >
                    {r.name}
                  </Link>
                )}
                <span className="text-xs text-ink-muted mr-1">{areaCount} 个区域</span>
                <DotMenu>
                  <button
                    className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-paper-dark transition-colors flex items-center gap-2"
                    onClick={() => startRename(r)}
                  >
                    <Pencil size={14} strokeWidth={1.5} />
                    改名
                  </button>
                  <button
                    className="w-full text-left px-4 py-2.5 text-sm text-danger-text hover:bg-danger-bg transition-colors flex items-center gap-2"
                    onClick={() => deleteRoom(r)}
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

      {/* ── FAB 添加房间 ──────────────────────────────── */}
      <div
        className="fixed z-30"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)', right: '20px' }}
      >
        {fabOpen && (
          <div className="mb-3 bg-paper-card border border-[var(--border-default)] rounded-[12px] shadow-lg p-3 space-y-2 w-64 relative">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-ink-muted">添加房间</span>
              <button
                type="button"
                onClick={() => setFabOpen(false)}
                className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded-full text-ink-muted hover:text-ink hover:bg-paper-dark transition-colors"
                aria-label="关闭"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>
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
        )}
        <button
          onClick={() => setFabOpen(v => !v)}
          className="w-14 h-14 rounded-full bg-accent hover:bg-accent-hover text-paper shadow-lg flex items-center justify-center transition-all active:scale-[0.95]"
          aria-label="添加房间"
        >
          <Plus
            size={24}
            strokeWidth={1.5}
            className={`transition-transform duration-300 ${fabOpen ? 'rotate-45' : ''}`}
          />
        </button>
      </div>
    </div>
  );
}
