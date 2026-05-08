import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { db, type ConflictRow } from '../db/dexie.js';
import { syncOnce } from '../sync/client.js';
import { scanReminders, type TriggeredReminder } from '../notifications/scanner.js';
import { ReminderRepo } from '../db/repos.js';

function ConflictBanner() {
  const [count, setCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<ConflictRow[]>([]);

  useEffect(() => {
    const tick = async () => {
      const n = await db.conflicts.where('acknowledged').equals(0).count();
      setCount(n);
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  if (count === 0) return null;

  const loadRows = async () => {
    const r = await db.conflicts.where('acknowledged').equals(0).toArray();
    setRows(r);
  };

  const toggle = () => {
    if (!expanded) loadRows();
    setExpanded(v => !v);
  };

  const acknowledgeAll = async () => {
    await db.conflicts.where('acknowledged').equals(0).modify({ acknowledged: 1 });
    setCount(0);
    setExpanded(false);
    setRows([]);
  };

  return (
    <div className="bg-danger-bg border-b border-danger/30 px-4 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-danger-text font-medium">⚠️ 检测到 {count} 条冲突</span>
        <button
          onClick={toggle}
          className="text-danger-text/80 hover:text-danger-text underline underline-offset-2"
        >
          {expanded ? '收起' : '查看详情'}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-1">
          {rows.map(r => (
            <div key={r.id} className="text-danger-text bg-danger-bg rounded px-2 py-1 border border-danger/20">
              <span className="font-mono">{r.table}/{r.row_id}</span> · 字段{' '}
              <span className="font-medium">{r.field}</span> · 本地{' '}
              <span className="text-warn-text">{JSON.stringify(r.client)}</span> / 服务端{' '}
              <span className="text-ink-muted">{JSON.stringify(r.server)}</span>
            </div>
          ))}
          <button
            onClick={acknowledgeAll}
            className="mt-1 px-3 py-1 rounded-[12px] bg-danger hover:opacity-90 text-paper font-medium transition-colors"
          >
            全部确认
          </button>
        </div>
      )}
    </div>
  );
}

function NotificationBanner() {
  const [triggered, setTriggered] = useState<TriggeredReminder[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const run = async () => {
      const t = await scanReminders();
      setTriggered(t);
    };
    run();
    const id = setInterval(run, 60_000);
    return () => clearInterval(id);
  }, []);

  if (triggered.length === 0) return null;

  const dismiss = async (t: TriggeredReminder) => {
    await ReminderRepo.updateFired(t.rule.id);
    setTriggered(prev => prev.filter(x => x.rule.id !== t.rule.id));
  };

  return (
    <div className="bg-warn-bg border-b border-warn/30 px-4 py-1.5 text-xs space-y-1">
      <p className="text-warn-text font-medium">🔔 {triggered.length} 条提醒待处理</p>
      {triggered.map(t => (
        <div key={t.rule.id} className="flex items-center gap-2 text-warn-text">
          <span className="flex-1">{t.reason}</span>
          <button
            onClick={() => navigate(`/items/${t.item.id}`)}
            className="underline underline-offset-2 hover:text-ink transition-colors"
          >
            查看
          </button>
          <button
            onClick={() => dismiss(t)}
            className="hover:text-ink transition-colors"
          >
            知道了
          </button>
        </div>
      ))}
    </div>
  );
}

export function Shell() {
  const loc = useLocation();
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const tick = async () => {
      setPending(await db.outbox.count());
    };
    tick();
    const i = setInterval(tick, 2000);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { clearInterval(i); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [loc.pathname]);

  const tabs = [
    { to: '/', label: '房间', icon: '🏠' },
    { to: '/search', label: '搜索', icon: '🔍' },
    { to: '/settings', label: '设置', icon: '⚙️' },
  ];

  return (
    <div className="min-h-full flex flex-col">
      {/* ── Header ────────────────────────────────────── */}
      <header className="sticky top-0 z-10 h-14 bg-paper/95 backdrop-blur-md border-b border-ink-faint px-4 flex items-center gap-3">
        <Link
          to="/"
          className="flex items-center gap-1.5 text-base font-bold font-serif tracking-tight text-ink hover:text-ink-hover transition-colors"
        >
          🗂️ Keepsake
        </Link>
        <div className="flex-1" />
        <Link
          to="/search"
          aria-label="搜索"
          className="w-9 h-9 flex items-center justify-center rounded-[12px] text-ink-muted hover:text-ink hover:bg-paper-dark transition-all duration-150"
        >
          🔍
        </Link>
        <Link
          to="/settings"
          aria-label="设置"
          className="w-9 h-9 flex items-center justify-center rounded-[12px] text-ink-muted hover:text-ink hover:bg-paper-dark transition-all duration-150"
        >
          ⚙️
        </Link>
      </header>

      {/* ── Offline / Pending banner ───────────────────── */}
      {(pending > 0 || !online) && (
        <div className="px-4 py-1.5 text-xs flex gap-3 items-center bg-paper-dark border-b border-ink-faint">
          {!online && <span className="text-warn-text">● 离线</span>}
          {pending > 0 && <span className="text-ink-muted">待同步 {pending}</span>}
          <button
            onClick={() => syncOnce()}
            className="ml-auto text-accent hover:text-accent-hover underline-offset-2 hover:underline transition-colors"
          >
            立即同步
          </button>
        </div>
      )}

      <ConflictBanner />
      <NotificationBanner />

      {/* ── Main content ──────────────────────────────── */}
      <main className="flex-1 px-4 py-4 max-w-3xl w-full mx-auto pb-6">
        <Outlet />
      </main>

      {/* ── Bottom nav ────────────────────────────────── */}
      <nav className="sticky bottom-0 z-10 h-16 pb-safe bg-paper/95 backdrop-blur-sm border-t border-ink-faint grid grid-cols-3">
        {tabs.map(t => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 text-xs transition-all duration-150 ${
                isActive ? 'text-ink font-semibold' : 'text-ink-muted hover:text-ink'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {/* Active indicator bar — accent color */}
                <span className={`w-6 h-0.5 rounded-full mb-0.5 transition-all duration-150 ${isActive ? 'bg-accent' : 'bg-transparent'}`} />
                <span className="text-base leading-none">{t.icon}</span>
                <span>{t.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
