import { useEffect, useState } from 'react';
import { useServerStatus } from '../sync/useServerStatus.js';
import { useT } from '../i18n/I18nContext.js';
import { kvGet } from '../db/dexie.js';

/** Settings 页顶部一行：圆点 + 文字 */
export function ServerStatusBadge() {
  const { t, lang } = useT();
  const status = useServerStatus();
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'online') return;
    let cancelled = false;
    const refresh = async () => {
      const ts = await kvGet<number>('sync_cursor');
      if (cancelled) return;
      if (ts) {
        const formatted = new Date(ts).toLocaleString(
          lang === 'en' ? 'en-US' : 'zh-CN',
          { hour: '2-digit', minute: '2-digit' }
        );
        setLastSync(formatted);
      } else {
        setLastSync(null);
      }
    };
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [status, lang]);

  const CONFIG = {
    checking: { color: 'bg-gray-400', label: t('serverStatus.checking') },
    online:   { color: 'bg-green-500', label: t('serverStatus.online') },
    offline:  { color: 'bg-red-500',   label: t('serverStatus.offline') },
  } as const;

  const { color, label } = CONFIG[status];
  return (
    <div className="flex items-center gap-2 text-sm text-ink-muted">
      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
      <span>
        {label}
        {status === 'online' && lastSync && (
          <> · {t('serverStatus.lastSync', { time: lastSync })}</>
        )}
      </span>
    </div>
  );
}
