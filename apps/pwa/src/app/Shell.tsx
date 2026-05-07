import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { db } from '../db/dexie.js';
import { syncOnce } from '../sync/client.js';

export function Shell() {
  const loc = useLocation();
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [online, setOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const tick = async () => {
      setPending(await db.outbox.count());
      setConflicts(await db.conflicts.where('acknowledged').equals(0).count());
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

      {(pending > 0 || conflicts > 0 || !online) && (
        <div className="px-4 py-2 text-xs flex gap-3 bg-slate-800/60 border-b border-slate-700">
          {!online && <span className="text-amber-300">● 离线</span>}
          {pending > 0 && <span className="text-sky-300">待同步 {pending}</span>}
          {conflicts > 0 && <span className="text-rose-300">冲突 {conflicts}</span>}
          <button
            onClick={() => syncOnce()}
            className="ml-auto text-slate-300 hover:text-white underline-offset-2 hover:underline"
          >
            立即同步
          </button>
        </div>
      )}

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
