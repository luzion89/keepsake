import { useServerStatus } from '../sync/useServerStatus.js';
import { useT } from '../i18n/I18nContext.js';

/** Settings 页顶部一行：圆点 + 文字 */
export function ServerStatusBadge() {
  const { t } = useT();
  const status = useServerStatus();

  const CONFIG = {
    checking: { color: 'bg-gray-400', label: t('serverStatus.checking') },
    online:   { color: 'bg-green-500', label: t('serverStatus.online') },
    offline:  { color: 'bg-red-500',   label: t('serverStatus.offline') },
  } as const;

  const { color, label } = CONFIG[status];
  return (
    <div className="flex items-center gap-2 text-sm text-ink-muted">
      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
      <span>{label}</span>
    </div>
  );
}
