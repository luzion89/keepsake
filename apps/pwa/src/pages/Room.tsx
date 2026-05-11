import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Area, Room } from '@keepsake/shared';
import { AreaRepo, ItemRepo, RoomRepo } from '../db/repos.js';
import { useConfirm } from '../components/ConfirmDialog.js';
import { useT } from '../i18n/I18nContext.js';
import { PRESET_NAMES } from '../i18n/dict.js';

const AREA_PRESETS = ['洗手台柜子', '墙壁柜', '电视柜', '沙发底下', '床底下', '吊柜', '抽屉', '工具箱'];

export function RoomPage() {
  const { t, lang } = useT();
  const { roomId = '' } = useParams();
  const [room, setRoom] = useState<Room | undefined>();
  const [areas, setAreas] = useState<Area[]>([]);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
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
      ? t('room.deleteAreaConfirm', { name: a.name })
      : t('room.deleteAreaWithItems', { name: a.name, n: items.length });
    const ok = await confirm(message, { danger: true, okText: t('common.delete') });
    if (!ok) return;
    for (const it of items) await ItemRepo.remove(it.id);
    await AreaRepo.remove(a.id);
    setSwipedId(null);
    await reload();
  };

  // Dismiss swipe when clicking elsewhere
  useEffect(() => {
    const close = () => setSwipedId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const displayName = (name: string) =>
    lang === 'en' && PRESET_NAMES[name] ? PRESET_NAMES[name] : name;

  if (!room) return <p className="text-ink-muted">{t('common.loading')}</p>;

  return (
    <div className="space-y-4">
      {dialog}

      {/* ── Breadcrumb ──────────────────────────────── */}
      <nav className="flex items-center gap-1 text-xl font-bold font-serif text-ink">
        <Link to="/" className="text-ink-muted hover:text-ink transition-colors text-sm font-normal font-sans">{t('nav.rooms')}</Link>
        <span className="text-ink-faint text-sm font-normal mx-1">›</span>
        <span>{displayName(room.name)}</span>
      </nav>

      {/* ── Area list ──────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">
          {t('room.areaList')} {areas.length > 0 && `(${areas.length})`}
        </h2>
        {areas.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <Package size={40} strokeWidth={1.5} className="text-ink-muted/40 mb-3" />
            <p className="text-ink-muted text-sm">{t('room.empty')}</p>
            <p className="text-ink-muted/70 text-xs mt-1">{t('room.emptyHint')}</p>
          </div>
        ) : (
          <ul className="bg-paper-card border border-[var(--border-default)] rounded-[12px] overflow-hidden divide-y divide-[var(--border-subtle)]">
            {areas.map(a => (
              <li
                key={a.id}
                className="relative overflow-hidden"
                onClick={(e) => {
                  if (swipedId === a.id && !(e.target as HTMLElement).closest('[data-delete]')) {
                    e.preventDefault();
                    e.stopPropagation();
                    setSwipedId(null);
                    return;
                  }
                  if (editingId === a.id) return;
                  if ((e.target as HTMLElement).closest('button')) return;
                  navigate(`/areas/${a.id}`);
                }}
              >
                {/* Delete background */}
                <div className="absolute inset-y-0 right-0 flex items-center bg-danger px-5 select-none" aria-hidden="true">
                  <Trash2 size={18} strokeWidth={1.5} className="text-paper" />
                  <span className="text-paper text-sm ml-1.5">{t('common.delete')}</span>
                </div>

                {/* Swipeable row */}
                <div
                  className="relative flex items-center px-4 min-h-[52px] bg-paper-card transition-transform duration-200 ease-out"
                  style={{ transform: swipedId === a.id ? 'translateX(-88px)' : 'translateX(0)', touchAction: 'pan-y' }}
                  onTouchStart={(e) => { touchStartX.current = e.touches[0]!.clientX; }}
                  onTouchEnd={(e) => {
                    if (touchStartX.current === null) return;
                    const delta = e.changedTouches[0]!.clientX - touchStartX.current;
                    touchStartX.current = null;
                    if (delta < -40) { e.stopPropagation(); setSwipedId(a.id); }
                    else if (delta > 10) setSwipedId(null);
                  }}
                >
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
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-0">
                        <span className="min-w-0 truncate text-sm font-medium text-ink">
                          {displayName(a.name)}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); startRename(a); }}
                          className="ml-1.5 shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-paper-dark transition-all"
                          aria-label={t('home.rename')}
                          title={t('home.rename')}
                        >
                          <Pencil size={14} strokeWidth={1.5} />
                        </button>
                      </div>
                      <div className="text-xs text-ink-muted">
                        {itemCounts[a.id] != null
                          ? itemCounts[a.id] === 0
                            ? t('area.empty')
                            : t('room.itemCount', { n: itemCounts[a.id] })
                          : ''}
                      </div>
                    </div>
                  )}
                </div>

                {swipedId === a.id && (
                  <button
                    data-delete="true"
                    className="absolute inset-y-0 right-0 w-[88px]"
                    onClick={(e) => { e.stopPropagation(); deleteArea(a); }}
                    aria-label={`${t('common.delete')} ${displayName(a.name)}`}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── FAB 添加区域 ─────────────────────────────── */}
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
          aria-label={fabOpen ? t('common.close') : t('room.addArea')}
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
            <p className="text-xs font-medium text-ink-muted">{t('room.addArea')}</p>
            <form onSubmit={(e) => { e.preventDefault(); add(name); }} className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('room.areaNamePlaceholder')}
                className="flex-1 min-w-0 bg-paper-dark border border-[var(--border-default)] rounded-[12px] px-3 py-2 text-sm outline-none focus:border-accent text-ink placeholder:text-ink-muted"
              />
              <button className="shrink-0 px-3 py-2 rounded-[12px] bg-accent hover:bg-accent-hover text-paper text-sm font-medium transition-all">
                {t('common.add')}
              </button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {AREA_PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => add(p)}
                  className="text-xs px-2.5 py-1.5 rounded-full bg-paper-dark border border-[var(--border-default)] hover:border-accent/50 text-ink-muted transition-all"
                >
                  + {lang === 'en' && PRESET_NAMES[p] ? PRESET_NAMES[p] : p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
