import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, ChevronRight } from 'lucide-react';
import { scanReminders, type TriggeredReminder } from '../notifications/scanner.js';
import { ReminderRepo } from '../db/repos.js';
import { useT } from '../i18n/I18nContext.js';

/**
 * #183: 提醒页面 — 与房间/搜索/设置同级
 */
export function RemindersPage() {
  const { t, lang } = useT();
  const [triggered, setTriggered] = useState<TriggeredReminder[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    const tr = await scanReminders();
    setTriggered(tr);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    const id = setInterval(reload, 60_000);
    return () => clearInterval(id);
  }, []);

  const dismiss = async (tr: TriggeredReminder) => {
    await ReminderRepo.updateFired(tr.rule.id);
    setTriggered(prev => prev.filter(x => x.rule.id !== tr.rule.id));
  };

  if (loading) {
    return <p className="text-ink-muted text-sm">{t('common.loading')}</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold font-serif text-ink flex items-center gap-2">
        <Bell size={22} strokeWidth={1.5} />
        {t('reminders.title')}
      </h1>

      {triggered.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <Bell size={48} strokeWidth={1} className="text-ink-muted/30 mb-4" />
          <p className="text-ink-muted text-sm">{t('reminders.empty')}</p>
          <p className="text-ink-muted/60 text-xs mt-1">{t('reminders.emptyHint')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {triggered.map(tr => (
            <li
              key={tr.rule.id}
              className="bg-paper-card border border-warn/40 rounded-[12px] px-4 py-3 space-y-2"
            >
              <div className="flex items-start gap-3">
                <Bell size={16} strokeWidth={1.5} className="text-warn-text mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink">{tr.reason}</p>
                  {tr.rule.note && (
                    <p className="text-xs text-ink-muted mt-0.5">{tr.rule.note}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2 pl-7">
                <Link
                  to={`/items/${tr.item.id}`}
                  className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  {t('reminders.goToItem')}
                  <ChevronRight size={12} strokeWidth={1.5} />
                </Link>
                <button
                  onClick={() => dismiss(tr)}
                  className="text-xs text-ink-muted hover:text-ink transition-colors ml-auto"
                >
                  {lang === 'en' ? 'Got it' : '知道了'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
