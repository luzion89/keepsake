import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Room, Area } from '@keepsake/shared';
import { AreaRepo, ItemRepo, RoomRepo } from '../db/repos.js';
import { useConfirm } from '../components/ConfirmDialog.js';

const AREA_PRESETS = ['洗手台柜子', '墙壁柜', '电视柜', '沙发底下', '床底下', '吊柜', '抽屉', '工具箱'];

/** 区域行内联设置菜单（固定定位，避免 overflow 裁剪） */
function AreaSettingsMenu({
  area,
  onRename,
  onDelete,
}: {
  area: Area;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const menuH = 88;
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow >= menuH ? rect.bottom + 4 : rect.top - menuH - 4;
      setMenuPos({ top, right: window.innerWidth - rect.right });
    }
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    document.addEventListener('pointerdown', handler, { once: true });
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={openMenu}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-muted hover:text-ink text-base transition-colors ml-1 shrink-0"
        aria-label={`${area.name} 设置`}
      >
        ···
      </button>
      {open && menuPos && (
        <div
          className="fixed z-50 bg-paper-card border border-[var(--border-default)] rounded-[12px] shadow-lg py-1 min-w-[120px]"
          style={{ top: menuPos.top, right: menuPos.right }}
          onPointerDown={e => e.stopPropagation()}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false); onRename(); }}
            className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-paper-dark transition-colors"
          >
            ✏️ 改名
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(); }}
            className="w-full text-left px-4 py-2.5 text-sm text-danger-text hover:bg-danger-bg/30 transition-colors"
          >
            🗑 删除
          </button>
        </div>
      )}
    </>
  );
}

export function RoomPage() {
  const { roomId = '' } = useParams();
  const [room, setRoom] = useState<Room | undefined>();
  const [areas, setAreas] = useState<Area[]>([]);
  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
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

  const startRename = (area: Area) => {
    setRenamingId(area.id);
    setRenameValue(area.name);
  };

  const commitRename = async () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return; }
    await AreaRepo.update(renamingId, { name: renameValue.trim() });
    setRenamingId(null);
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
    <div className="space-y-6">
      {dialog}

      {/* 改名对话框 */}
      {renamingId && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30" onPointerDown={() => setRenamingId(null)}>
          <div className="bg-paper-card rounded-[16px] p-5 w-72 shadow-lg space-y-3" onPointerDown={e => e.stopPropagation()}>
            <p className="text-sm font-medium text-ink">重命名区域</p>
            <input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
              className="w-full bg-paper-dark border border-[var(--border-default)] rounded-[12px] px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRenamingId(null)} className="px-3 py-2 text-sm text-ink-muted hover:text-ink transition-colors">取消</button>
              <button onClick={commitRename} className="px-4 py-2 rounded-[12px] bg-accent hover:bg-accent-hover text-paper text-sm font-medium transition-all">确认</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 面包屑 ────────────────────────────────────── */}
      <nav className="flex items-center gap-1 text-xs text-ink-muted">
        <Link to="/" className="hover:text-ink transition-colors">房间</Link>
        <span className="text-ink-faint">›</span>
        <span className="text-ink">{room.name}</span>
      </nav>

      <h1 className="text-2xl font-bold font-serif text-ink">{room.name}</h1>

      {/* ── 添加区域表单 ──────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">添加区域</h2>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(name); }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="区域名（如 洗手台柜子）"
            className="flex-1 min-w-0 bg-paper-card border border-[var(--border-default)] rounded-[12px] px-4 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all duration-150 text-ink placeholder:text-ink-muted"
          />
          <button className="shrink-0 px-4 py-3 rounded-[12px] bg-accent hover:bg-accent-hover active:scale-[0.97] text-paper font-medium text-sm shadow-card transition-all duration-150">
            添加
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {AREA_PRESETS.map(p => (
            <button
              key={p}
              onClick={() => add(p)}
              className="text-xs px-3 py-2 min-h-[44px] rounded-full bg-paper-card border border-[var(--border-default)] hover:border-accent/50 hover:bg-paper-dark text-ink-muted transition-all duration-150"
            >
              + {p}
            </button>
          ))}
        </div>
      </section>

      {/* ── 区域列表 ──────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">
          区域 {areas.length > 0 && `(${areas.length})`}
        </h2>
        {areas.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <span className="text-4xl mb-3">📦</span>
            <p className="text-ink-muted text-sm">这个房间还没有区域</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {areas.map(a => (
              <li key={a.id} className="flex items-center px-4 py-3.5 bg-paper-card border border-[var(--border-default)] rounded-[12px] hover:border-accent/40 shadow-card transition-all duration-150">
                <span className="text-base mr-3">📦</span>
                <Link
                  to={`/areas/${a.id}`}
                  className="flex-1 text-sm font-medium font-serif text-ink hover:text-ink-hover"
                >
                  {a.name}
                </Link>
                <AreaSettingsMenu
                  area={a}
                  onRename={() => startRename(a)}
                  onDelete={() => deleteArea(a)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
