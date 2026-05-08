import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Room } from '@keepsake/shared';
import { AreaRepo, ItemRepo, RoomRepo } from '../db/repos.js';
import { useConfirm } from '../components/ConfirmDialog.js';

const PRESETS = ['厨房', '客厅', '阳台', '主卧', '次卧', '卫生间', '储物间', '玄关'];

/** 房间卡片内联设置菜单（固定定位，避免 overflow 裁剪） */
function RoomSettingsMenu({
  room,
  onRename,
  onDelete,
}: {
  room: Room;
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
      // 菜单尺寸约 120×80，检测底部空间
      const menuH = 88;
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow >= menuH ? rect.bottom + 4 : rect.top - menuH - 4;
      setMenuPos({ top, right: window.innerWidth - rect.right });
    }
    setOpen(o => !o);
  };

  // 点击外部关闭
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
        className="absolute top-2 right-2 min-w-[44px] min-h-[44px] rounded-full bg-paper-dark text-ink-muted text-base opacity-0 group-hover:opacity-100 hover:bg-paper-dark/80 transition-all duration-150 flex items-center justify-center z-10"
        aria-label={`${room.name} 设置`}
        title="设置"
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

export function HomePage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const { confirm, dialog } = useConfirm();

  const reload = async () => {
    const list = await RoomRepo.list();
    setRooms(list);
    setLoading(false);
  };
  useEffect(() => { reload(); }, []);

  const add = async (n: string) => {
    const trimmed = n.trim();
    if (!trimmed) return;
    await RoomRepo.create({ name: trimmed });
    setName('');
    await reload();
  };

  const startRename = (room: Room) => {
    setRenamingId(room.id);
    setRenameValue(room.name);
  };

  const commitRename = async () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return; }
    await RoomRepo.update(renamingId, { name: renameValue.trim() });
    setRenamingId(null);
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
    <div className="space-y-6">
      {dialog}

      {/* 改名对话框 */}
      {renamingId && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30" onPointerDown={() => setRenamingId(null)}>
          <div className="bg-paper-card rounded-[16px] p-5 w-72 shadow-lg space-y-3" onPointerDown={e => e.stopPropagation()}>
            <p className="text-sm font-medium text-ink">重命名房间</p>
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

      {/* ── 添加房间表单 ──────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">添加房间</h2>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(name); }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="房间名（如 厨房）"
            className="flex-1 min-w-0 bg-paper-card border border-[var(--border-default)] rounded-[12px] px-4 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all duration-150 text-ink placeholder:text-ink-muted"
          />
          <button className="shrink-0 px-4 py-3 rounded-[12px] bg-accent hover:bg-accent-hover active:scale-[0.97] text-paper font-medium text-sm shadow-card transition-all duration-150">
            添加
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map(p => (
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

      {/* ── 房间列表 ──────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">
          我的房间 {rooms.length > 0 && `(${rooms.length})`}
        </h2>
        {loading ? (
          <div className="flex flex-col items-center py-12 text-center">
            <p className="text-ink-muted text-sm">加载中…</p>
          </div>
        ) : rooms.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <span className="text-4xl mb-3">🏠</span>
            <p className="text-ink-muted text-sm font-medium">还没有房间</p>
            <p className="text-ink-muted/70 text-xs mt-1">点上面的预设或输入自定义名称添加</p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {rooms.map(r => (
              <li key={r.id} className="relative group">
                <Link
                  to={`/rooms/${r.id}`}
                  className="block aspect-square rounded-[12px] bg-paper-card border border-[var(--border-default)] hover:border-accent/40 hover:shadow-card p-4 flex flex-col transition-all duration-150"
                >
                  <span className="text-base font-semibold font-serif text-ink pr-8">{r.name}</span>
                  <span className="mt-auto text-xs text-ink-muted">→</span>
                </Link>
                <RoomSettingsMenu
                  room={r}
                  onRename={() => startRename(r)}
                  onDelete={() => deleteRoom(r)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
