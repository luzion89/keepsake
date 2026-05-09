import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, ChevronRight } from 'lucide-react';
import { scanReminders, type TriggeredReminder } from '../notifications/scanner.js';
import { ReminderRepo } from '../db/repos.js';

/**
 * #183: 提醒页面 — 与房间/搜索/设置同级
 * 列出所有当前触发的提醒，可点击跳转物品详情。
 */
export function RemindersPage() {
  const [triggered, setTriggered] = useState<TriggeredReminder[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    const t = await scanReminders();
    setTriggered(t);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    const id = setInterval(reload, 60_000);
    return () => clearInterval(id);
  }, []);

  const dismiss = async (t: TriggeredReminder) => {
    await ReminderRepo.updateFired(t.rule.id);
    setTriggered(prev => prev.filter(x => x.rule.id !== t.rule.id));
  };

  if (loading) {
    return <p className="text-ink-muted text-sm">加载中…</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold font-serif text-ink flex items-center gap-2">
        <Bell size={22} strokeWidth={1.5} />
        提醒
      </h1>

      {triggered.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <Bell size={48} strokeWidth={1} className="text-ink-muted/30 mb-4" />
          <p className="text-ink-muted text-sm">暂无待处理提醒</p>
          <p className="text-ink-muted/60 text-xs mt-1">物品过期或库存不足时会在这里显示</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {triggered.map(t => (
            <li
              key={t.rule.id}
              className="bg-paper-card border border-warn/40 rounded-[12px] px-4 py-3 space-y-2"
            >
              <div className="flex items-start gap-3">
                <Bell size={16} strokeWidth={1.5} className="text-warn-text mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink">{t.reason}</p>
                  {t.rule.note && (
                    <p className="text-xs text-ink-muted mt-0.5">{t.rule.note}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2 pl-7">
                <Link
                  to={`/items/${t.item.id}`}
                  className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  查看物品
                  <ChevronRight size={12} strokeWidth={1.5} />
                </Link>
                <button
                  onClick={() => dismiss(t)}
                  className="text-xs text-ink-muted hover:text-ink transition-colors ml-auto"
                >
                  知道了
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
