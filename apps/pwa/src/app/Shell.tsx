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
    <div className="bg-rose-950 border-b border-rose-700 px-4 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-rose-300 font-medium">⚠️ 检测到 {count} 条冲突</span>
        <button
          onClick={toggle}
          className="text-rose-200 hover:text-white underline underline-offset-2"
        >
          {expanded ? '收起' : '查看详情'}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-1">
          {rows.map(r => (
            <div key={r.id} className="text-rose-200 bg-rose-900/50 rounded px-2 py-1">
              <span className="font-mono">{r.table}/{r.row_id}</span> · 字段{' '}
              <span className="font-medium">{r.field}</span> · 本地{' '}
              <span className="text-amber-300">{JSON.stringify(r.client)}</span> / 服务端{' '}
              <span className="text-sky-300">{JSON.stringify(r.server)}</span>
            </div>
          ))}
          <button
            onClick={acknowledgeAll}
            className="mt-1 px-3 py-1 rounded bg-rose-700 hover:bg-rose-600 text-white font-medium"
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
    <div className="bg-amber-950 border-b border-amber-700 px-4 py-2 text-xs space-y-1">
      <p className="text-amber-300 font-medium">🔔 {triggered.length} 条提醒待处理</p>
      {triggered.map(t => (
        <div key={t.rule.id} className="flex items-center gap-2 text-amber-200">
          <span className="flex-1">{t.reason}</span>
          <button
            onClick={() => navigate(`/items/${t.item.id}`)}
            className="underline underline-offset-2 hover:text-white"
          >
            查看
          </button>
          <button
            onClick={() => dismiss(t)}
            className="text-amber-400 hover:text-white"
          >
            知道了
          </button>
        </div>
      ))}
    </div>
  );
}

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
    <div className="bg-rose-950 border-b border-rose-700 px-4 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-rose-300 font-medium">⚠️ 检测到 {count} 条冲突</span>
        <button
          onClick={toggle}
          className="text-rose-200 hover:text-white underline underline-offset-2"
        >
          {expanded ? '收起' : '查看详情'}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-1">
          {rows.map(r => (
            <div key={r.id} className="text-rose-200 bg-rose-900/50 rounded px-2 py-1">
              <span className="font-mono">{r.table}/{r.row_id}</span> · 字段{' '}
              <span className="font-medium">{r.field}</span> · 本地{' '}
              <span className="text-amber-300">{JSON.stringify(r.client)}</span> / 服务端{' '}
              <span className="text-sky-300">{JSON.stringify(r.server)}</span>
            </div>
          ))}
          <button
            onClick={acknowledgeAll}
            className="mt-1 px-3 py-1 rounded bg-rose-700 hover:bg-rose-600 text-white font-medium"
          >
            全部确认
          </button>
        </div>
      )}
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

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center gap-3">
        <Link to="/" className="font-semibold tracking-tight text-lg">Keepsake</Link>
        <div className="flex-1" />
        <Link to="/search" className="text-sm text-slate-300 hover:text-white">搜索</Link>
        <Link to="/settings" className="text-sm text-slate-300 hover:text-white">设置</Link>
      </header>

      {(pending > 0 || !online) && (
        <div className="px-4 py-2 text-xs flex gap-3 bg-slate-800/60 border-b border-slate-700">
          {!online && <span className="text-amber-300">● 离线</span>}
          {pending > 0 && <span className="text-sky-300">待同步 {pending}</span>}
          <button
            onClick={() => syncOnce()}
            className="ml-auto text-slate-300 hover:text-white underline-offset-2 hover:underline"
          >
            立即同步
          </button>
        </div>
      )}

      <ConflictBanner />
      <NotificationBanner />

      <main className="flex-1 px-4 py-4 max-w-3xl w-full mx-auto">
        <Outlet />
      </main>

      <nav className="sticky bottom-0 bg-slate-900 border-t border-slate-800 grid grid-cols-3 text-center text-sm">
        {[
          { to: '/', label: '房间' },
          { to: '/search', label: '搜索' },
          { to: '/settings', label: '设置' },
        ].map(t => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              `py-3 ${isActive ? 'text-sky-300' : 'text-slate-400 hover:text-slate-100'}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
