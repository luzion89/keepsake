import { useServerStatus } from '../sync/useServerStatus.js';

const CONFIG = {
  checking: { color: 'bg-gray-400', label: '检查中' },
  online:   { color: 'bg-green-500', label: '已连接' },
  offline:  { color: 'bg-red-500',   label: 'server 离线（本地操作仍正常）' },
} as const;

/** Settings 页顶部一行：圆点 + 文字 */
export function ServerStatusBadge() {
  const status = useServerStatus();
  const { color, label } = CONFIG[status];
  return (
    <div className="flex items-center gap-2 text-sm text-ink-muted">
      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
      <span>{label}</span>
    </div>
  );
}

/** 主页 header 右侧小圆点（仅颜色，不显示文字） */
export function ServerStatusDot() {
  const status = useServerStatus();
  const { color } = CONFIG[status];
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${color}`}
      title={CONFIG[status].label}
    />
  );
}
