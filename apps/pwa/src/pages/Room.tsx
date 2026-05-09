import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { MoreHorizontal, Package, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Area, Room } from '@keepsake/shared';
import { AreaRepo, ItemRepo, RoomRepo } from '../db/repos.js';
import { useConfirm } from '../components/ConfirmDialog.js';

const AREA_PRESETS = ['洗手台柜子', '墙壁柜', '电视柜', '沙发底下', '床底下', '吊柜', '抽屉', '工具箱'];

function DotMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (
        !btnRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen(v => !v);
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-ink-muted hover:text-ink transition-colors"
        aria-label="更多操作"
      >
        <MoreHorizontal size={18} strokeWidth={1.5} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999 }}
          className="bg-paper-card border border-[var(--border-default)] rounded-[12px] shadow-lg overflow-hidden min-w-[120px]"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>,
        document.body
      )}
    </div>
  );
}

export function RoomPage() {
  const { roomId = '' } = useParams();
  const [room, setRoom] = useState<Room | undefined>();
  const [areas, setAreas] = useState<Area[]>([]);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [fabOpen, setFabOpen] = useState(false);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const editRef = useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useConfirm();

  const reload = async () => {
    setRoom(await RoomRepo.get(roomId));
    const areaList = await AreaRepo.listByRoom(roomId);
    setAreas(areaList);
    const counts: Record<string, number> = {};
    await Promise.all(areaList.map(async a => {
      const its = await ItemRepo.listByArea(a.id);
      counts[a.id] = its.length;
    }));
    setItemCounts(counts);
  };
  useEffect(() => { reload(); }, [roomId]);

  const add = async (n: string) => {
    const trimmed = n.trim();
    if (!trimmed) return;
    await AreaRepo.create({ room_id: roomId, name: trimmed });
    setName('');
    setFabOpen(false);
    await reload();
  };

  const startRename = (a: Area) => {
    setEditingId(a.id);
    setEditName(a.name);
    setTimeout(() => editRef.current?.focus(), 50);
  };

  const commitRename = async (id: string) => {
    const trimmed = editName.trim();
    if (trimmed) await AreaRepo.update(id, { name: trimmed });
    setEditingId(null);
    await reload();
  };

  const deleteArea = async (a: Area) => {
    const items = await ItemRepo.listByArea(a.id);
    const message = items.length === 0
      ? `删除区域「${a.name}」？`
      : `「${a.name}」下还有 ${items.length} 个物品，将一并软删除。继续？`;
    const ok = await confirm(message, { danger: true, okText: '删除' });
    if (!ok) return;
    for (const it of items) await ItemRepo.remove(it.id);
    await AreaRepo.remove(a.id);
    await reload();
  };

  if (!room) return <p className="text-ink-muted">加载中…</p>;

  return (
    <div className="space-y-4">
      {dialog}

      {/* ── 面包屑兼标题 ──────────────────────────────── */}
      <nav className="flex items-center gap-1 text-xl font-bold font-serif text-ink">
        <Link to="/" className="text-ink-muted hover:text-ink transition-colors text-sm font-normal font-sans">房间</Link>
        <span className="text-ink-faint text-sm font-normal mx-1">›</span>
        <span>{room.name}</span>
      </nav>

      {/* ── 区域列表 ──────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">
          区域 {areas.length > 0 && `(${areas.length})`}
        </h2>
        {areas.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <Package size={40} strokeWidth={1.5} className="text-ink-muted/40 mb-3" />
            <p className="text-ink-muted text-sm">这个房间还没有区域</p>
            <p className="text-ink-muted/70 text-xs mt-1">点右下角 + 添加区域</p>
          </div>
        ) : (
          <ul className="bg-paper-card border border-[var(--border-default)] rounded-[12px] overflow-hidden divide-y divide-[var(--border-subtle)]">
            {areas.map(a => (
              <li key={a.id} className="flex items-center px-4 min-h-[52px]">
                <Package size={18} strokeWidth={1.5} className="text-ink-muted mr-3 shrink-0" />
                {editingId === a.id ? (
                  <input
                    ref={editRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => commitRename(a.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(a.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="flex-1 bg-paper-dark border border-accent rounded-[8px] px-2 py-1 text-sm outline-none text-ink"
                  />
                ) : (
                  <Link
                    to={`/areas/${a.id}`}
                    className="flex-1 min-w-0 hover:text-ink-hover transition-colors"
                  >
                    <div className="text-sm font-medium font-serif text-ink">{a.name}</div>
                    <div className="text-xs text-ink-muted">
                      {itemCounts[a.id] != null
                        ? itemCounts[a.id] === 0 ? '暂无物品' : `${itemCounts[a.id]} 种物品`
                        : ''}
                    </div>
                  </Link>
                )}
                <DotMenu>
                  <button
                    className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-paper-dark transition-colors flex items-center gap-2"
                    onClick={() => startRename(a)}
                  >
                    <Pencil size={14} strokeWidth={1.5} />
                    改名
                  </button>
                  <button
                    className="w-full text-left px-4 py-2.5 text-sm text-danger-text hover:bg-danger-bg transition-colors flex items-center gap-2"
                    onClick={() => deleteArea(a)}
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

      {/* ── FAB 添加区域 (#154 重做) ─────────────────
           规格：圆形加号 → 点击后按钮上移 + 输入框从下 slide-in
                 按钮图标 Plus→X；点击 X 或 backdrop 反向收回  */}
      {/* Backdrop */}
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
        {/* FAB 圆形按钮：始终在容器顶部；容器底部固定，开启时面板从下方展开，
            容器整体向上增长，按钮自然上移至输入框右上角 (#168) */}
        <button
          onClick={() => setFabOpen(v => !v)}
          className="w-14 h-14 rounded-full bg-accent hover:bg-accent-hover text-paper shadow-lg flex items-center justify-center transition-all duration-300 active:scale-[0.95]"
          aria-label={fabOpen ? '关闭' : '添加区域'}
        >
          <span
            className="transition-transform duration-300"
            style={{ transform: fabOpen ? 'rotate(45deg)' : 'rotate(0deg)' }}
          >
            <Plus size={24} strokeWidth={1.5} />
          </span>
        </button>
        {/* 输入面板：在按钮下方 slide-in，容器底部固定故整体上移 */}
        <div
          className="overflow-hidden transition-all duration-300 ease-out"
          style={{
            maxHeight: fabOpen ? '320px' : '0px',
            opacity: fabOpen ? 1 : 0,
            marginTop: fabOpen ? '12px' : '0px',
          }}
        >
          <div className="bg-paper-card border border-[var(--border-default)] rounded-[12px] shadow-lg p-3 space-y-2 w-64">
            <p className="text-xs font-medium text-ink-muted">添加区域</p>
            <form onSubmit={(e) => { e.preventDefault(); add(name); }} className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="区域名（如 洗手台柜子）"
                className="flex-1 min-w-0 bg-paper-dark border border-[var(--border-default)] rounded-[12px] px-3 py-2 text-sm outline-none focus:border-accent text-ink placeholder:text-ink-muted"
              />
              <button className="shrink-0 px-3 py-2 rounded-[12px] bg-accent hover:bg-accent-hover text-paper text-sm font-medium transition-all">
                添加
              </button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {AREA_PRESETS.map(p => (
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
