import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Minus, Plus, X } from 'lucide-react';
import type { Area, Item, Room, ReminderRule } from '@keepsake/shared';
import { AreaRepo, ItemRepo, ReminderRepo, RoomRepo } from '../db/repos.js';
import { db } from '../db/dexie.js';
import { useConfirm } from '../components/ConfirmDialog.js';

/** Calculate remaining days from now to a UTC ms timestamp, using local-date arithmetic. */
function calcRemainingDays(expiresAtMs: number): number {
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const expDate = new Date(expiresAtMs);
  const expUTC = Date.UTC(expDate.getFullYear(), expDate.getMonth(), expDate.getDate());
  return Math.round((expUTC - todayUTC) / 86400000);
}

function ExpiryBadge({ expiresAt }: { expiresAt: number }) {
  const days = calcRemainingDays(expiresAt);
  if (days < 0) {
    return <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-danger-bg text-danger-text">已过期</span>;
  }
  if (days < 7) {
    return <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-danger-bg text-danger-text">剩 {days} 天</span>;
  }
  if (days <= 30) {
    return <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-warn-bg text-warn-text">剩 {days} 天</span>;
  }
  return <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-ok-bg text-ok-text">剩 {days} 天</span>;
}

// #181 fix: use string state for thresholdQtyStr so user can freely edit/clear
function ReminderSection({ itemId }: { itemId: string }) {
  const [rules, setRules] = useState<ReminderRule[]>([]);
  const [adding, setAdding] = useState(false);
  const [mainType, setMainType] = useState<'expiry_group' | 'low_stock'>('expiry_group');
  const [expirySubType, setExpirySubType] = useState<'expiry' | 'recheck'>('recheck');
  const [expiryDaysStr, setExpiryDaysStr] = useState('7');
  const [recheckDaysStr, setRecheckDaysStr] = useState('30');
  // #181: string state allows clearing without auto-converting to 0
  const [thresholdQtyStr, setThresholdQtyStr] = useState('1');
  const [note, setNote] = useState('');

  const reload = async () => {
    setRules(await ReminderRepo.listByItem(itemId));
  };
  useEffect(() => { reload(); }, [itemId]);

  const save = async () => {
    let kind: ReminderRule['kind'];
    let threshold_at: number | undefined;
    let threshold_qty: number | undefined;

    if (mainType === 'low_stock') {
      kind = 'low_stock';
      const n = parseInt(thresholdQtyStr, 10);
      threshold_qty = isNaN(n) || n < 0 ? 1 : n;
    } else {
      kind = expirySubType;
      if (expirySubType === 'expiry') {
        const d = Math.max(1, parseInt(expiryDaysStr, 10) || 7);
        threshold_at = d * 24 * 60 * 60 * 1000;
      } else {
        const d = Math.max(1, parseInt(recheckDaysStr, 10) || 30);
        threshold_at = d * 24 * 60 * 60 * 1000;
      }
    }
    await ReminderRepo.create({ item_id: itemId, kind, threshold_at, threshold_qty, note: note || undefined });
    setAdding(false);
    setNote('');
    await reload();
  };

  const remove = async (id: string) => {
    await ReminderRepo.remove(id);
    await reload();
  };

  const kindLabel = (r: ReminderRule): string => {
    if (r.kind === 'low_stock') return `库存不足（≤${r.threshold_qty ?? '?'}）`;
    if (r.kind === 'expiry') {
      const days = r.threshold_at != null ? Math.round(r.threshold_at / 86400000) : 7;
      return `过期提醒 · 有效期前 ${days} 天`;
    }
    const days = r.threshold_at != null ? Math.round(r.threshold_at / 86400000) : 30;
    return `过期提醒 · 每隔 ${days} 天复查`;
  };

  const mainBtnCls = (active: boolean) =>
    `flex-1 py-2 rounded-[12px] border text-sm font-medium transition-all ${
      active
        ? 'border-accent/60 bg-accent-light text-accent'
        : 'border-[var(--border-default)] text-ink-muted hover:border-accent/30'
    }`;

  const subBtnCls = (active: boolean) =>
    `flex items-start gap-2.5 w-full px-3 py-2.5 rounded-[12px] border text-sm transition-all cursor-pointer ${
      active
        ? 'border-accent/60 bg-accent-light'
        : 'border-[var(--border-default)] hover:border-accent/30'
    }`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-sm font-medium text-ink">提醒规则</span>
        <button
          onClick={() => setAdding(v => !v)}
          className="text-xs text-accent hover:text-accent-hover transition-colors flex items-center gap-1"
        >
          <Plus size={12} strokeWidth={2} />
          添加提醒
        </button>
      </div>

      {adding && (
        <div className="mx-4 mb-2 bg-paper-dark border border-[var(--border-default)] rounded-[12px] p-3 space-y-3 text-sm">
          <p className="text-xs text-ink-muted">提醒方式：打开 App 时页面横幅提示（暂不支持系统推送）</p>

          <div>
            <p className="text-xs text-ink-muted mb-1.5">提醒类型</p>
            <div className="flex gap-2">
              <button onClick={() => setMainType('expiry_group')} className={mainBtnCls(mainType === 'expiry_group')}>
                过期提醒
              </button>
              <button onClick={() => setMainType('low_stock')} className={mainBtnCls(mainType === 'low_stock')}>
                库存不足
              </button>
            </div>
          </div>

          {mainType === 'expiry_group' && (
            <div className="space-y-2">
              <p className="text-xs text-ink-muted">提醒策略</p>

              <button onClick={() => setExpirySubType('recheck')} className={subBtnCls(expirySubType === 'recheck')}>
                <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${expirySubType === 'recheck' ? 'border-accent' : 'border-[var(--border-default)]'}`}>
                  {expirySubType === 'recheck' && <span className="w-2 h-2 rounded-full bg-accent" />}
                </span>
                <span className="flex-1 text-left">
                  <span className={`font-medium ${expirySubType === 'recheck' ? 'text-accent' : 'text-ink'}`}>每隔 N 天复查</span>
                  <span className="block text-xs text-ink-muted mt-0.5">无需设置有效期，定期提醒重新检查物品</span>
                  {expirySubType === 'recheck' && (
                    <div className="flex items-center gap-2 mt-2" onClick={e => e.stopPropagation()}>
                      <span className="text-xs text-ink-muted">间隔天数</span>
                      <input
                        type="number"
                        min={1}
                        value={recheckDaysStr}
                        onChange={e => setRecheckDaysStr(e.target.value)}
                        onBlur={() => {
                          const n = parseInt(recheckDaysStr, 10);
                          setRecheckDaysStr(String(isNaN(n) || n < 1 ? 30 : n));
                        }}
                        className="w-16 bg-paper-card border border-[var(--border-default)] rounded-[8px] px-2 py-1 text-xs outline-none focus:border-accent transition-all text-ink"
                      />
                      <span className="text-xs text-ink-muted">天</span>
                    </div>
                  )}
                </span>
              </button>

              <button onClick={() => setExpirySubType('expiry')} className={subBtnCls(expirySubType === 'expiry')}>
                <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${expirySubType === 'expiry' ? 'border-accent' : 'border-[var(--border-default)]'}`}>
                  {expirySubType === 'expiry' && <span className="w-2 h-2 rounded-full bg-accent" />}
                </span>
                <span className="flex-1 text-left">
                  <span className={`font-medium ${expirySubType === 'expiry' ? 'text-accent' : 'text-ink'}`}>过期前 N 天提醒</span>
                  <span className="block text-xs text-ink-muted mt-0.5">需为物品设置有效期，在截止日前触发</span>
                  {expirySubType === 'expiry' && (
                    <div className="flex items-center gap-2 mt-2" onClick={e => e.stopPropagation()}>
                      <span className="text-xs text-ink-muted">提前天数</span>
                      <input
                        type="number"
                        min={1}
                        value={expiryDaysStr}
                        onChange={e => setExpiryDaysStr(e.target.value)}
                        onBlur={() => {
                          const n = parseInt(expiryDaysStr, 10);
                          setExpiryDaysStr(String(isNaN(n) || n < 1 ? 7 : n));
                        }}
                        className="w-16 bg-paper-card border border-[var(--border-default)] rounded-[8px] px-2 py-1 text-xs outline-none focus:border-accent transition-all text-ink"
                      />
                      <span className="text-xs text-ink-muted">天</span>
                    </div>
                  )}
                </span>
              </button>
            </div>
          )}

          {/* #181 fix: thresholdQtyStr string state, blur 时校验 */}
          {mainType === 'low_stock' && (
            <div className="flex items-center gap-2">
              <span className="text-ink-muted text-xs">库存阈值</span>
              <input
                type="number"
                min={0}
                value={thresholdQtyStr}
                onChange={e => setThresholdQtyStr(e.target.value)}
                onBlur={() => {
                  const n = parseInt(thresholdQtyStr, 10);
                  if (isNaN(n) || n < 0) setThresholdQtyStr('1');
                }}
                className="w-20 bg-paper-card border border-[var(--border-default)] rounded-[12px] px-3 py-1.5 outline-none focus:border-accent transition-all text-ink"
              />
              <span className="text-xs text-ink-muted">（数量 ≤ 此值时提醒）</span>
            </div>
          )}

          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="备注（可选）"
            className="w-full bg-paper-card border border-[var(--border-default)] rounded-[12px] px-3 py-2 outline-none focus:border-accent transition-all text-ink placeholder:text-ink-muted"
          />
          <div className="flex gap-2">
            <button onClick={save} className="flex-1 px-3 py-2 rounded-[12px] bg-accent hover:bg-accent-hover text-paper font-medium transition-all">保存</button>
            <button onClick={() => setAdding(false)} className="px-3 py-2 rounded-[12px] border border-[var(--border-default)] text-ink-muted hover:text-ink transition-all">取消</button>
          </div>
        </div>
      )}

      {rules.length > 0 && (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {rules.map(r => (
            <li key={r.id} className="flex items-center gap-2 px-4 py-1.5 text-xs">
              <span className="flex-1 text-ink">
                {kindLabel(r)}
                {r.note && <span className="text-ink-muted ml-1">— {r.note}</span>}
              </span>
              <button
                onClick={() => remove(r.id)}
                className="min-w-[44px] min-h-[44px] text-ink-muted hover:text-danger-text transition-colors flex items-center justify-center"
                aria-label="删除提醒"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Reusable grouped section wrapper (iOS-style card) */
function SectionCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted px-1">{label}</h2>
      <div className="bg-paper-card rounded-[12px] border border-[var(--border-default)] overflow-hidden divide-y divide-[var(--border-subtle)]">
        {children}
      </div>
    </div>
  );
}

/** A label-value row inside a SectionCard */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 min-h-[48px]">
      <span className="text-sm text-ink-muted w-16 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export function ItemPage() {
  const { itemId = '' } = useParams();
  const [item, setItem] = useState<Item | undefined>();
  const [area, setArea] = useState<Area | undefined>();
  const [room, setRoom] = useState<Room | undefined>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: '', qty: 0, unit: '', notes: '', tags: '', expiresDate: '' });
  const { confirm, dialog } = useConfirm();

  const reload = async () => {
    const it = await db.items.get(itemId);
    setItem(it);
    if (it) {
      setDraft({
        name: it.name,
        qty: it.qty,
        unit: it.unit ?? '',
        notes: it.notes ?? '',
        tags: it.tags.join(', '),
        expiresDate: it.expires_at ? new Date(it.expires_at).toISOString().slice(0, 10) : '',
      });
      const a = await AreaRepo.get(it.area_id);
      setArea(a);
      if (a) {
        const r = await RoomRepo.get(a.room_id);
        setRoom(r);
      }
    }
  };
  useEffect(() => { reload(); }, [itemId]);

  if (!item) return <p className="text-ink-muted">加载中…</p>;

  const save = async () => {
    const expires_at = draft.expiresDate
      ? new Date(draft.expiresDate + 'T00:00:00').getTime()
      : undefined;
    const tags = draft.tags.split(',').map(t => t.trim()).filter(Boolean);
    await ItemRepo.update(item.id, {
      name: draft.name,
      qty: draft.qty,
      unit: draft.unit || undefined,
      notes: draft.notes,
      tags,
      expires_at,
    });
    setEditing(false);
    await reload();
  };

  const remove = async () => {
    if (!await confirm(`删除 "${item.name}"?`, { danger: true, okText: '删除' })) return;
    await ItemRepo.remove(item.id);
    history.back();
  };

  // #180: quick adjust qty from view mode
  const adjustQty = async (delta: number) => {
    const newQty = Math.max(0, item.qty + delta);
    await ItemRepo.update(item.id, { qty: newQty });
    await reload();
  };

  return (
    <div className="space-y-5">
      {dialog}
      <nav className="text-xs text-ink-muted space-y-1">
        <Link to={`/areas/${item.area_id}`} className="hover:text-ink transition-colors flex items-center gap-1">
          <ChevronLeft size={14} strokeWidth={1.5} />
          返回区域
        </Link>
        {(room || area) && (
          <div className="flex items-center gap-1 text-ink-muted">
            <span className="text-xs">📍</span>
            {room ? (
              <Link to={`/rooms/${room.id}`} className="hover:text-ink transition-colors">{room.name}</Link>
            ) : null}
            {room && area && <span>/</span>}
            {area ? (
              <Link to={`/areas/${area.id}`} className="hover:text-ink transition-colors">{area.name}</Link>
            ) : null}
          </div>
        )}
      </nav>

      {editing ? (
        <div className="space-y-4">
          <SectionCard label="基本信息">
            <FieldRow label="名称">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full bg-transparent text-sm text-ink outline-none py-1"
              />
            </FieldRow>
            <FieldRow label="数量">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={draft.qty}
                  onChange={(e) => setDraft({ ...draft, qty: Number(e.target.value) })}
                  className="w-20 bg-paper-dark border border-[var(--border-default)] rounded-[8px] px-3 py-1.5 text-sm outline-none focus:border-accent transition-all text-ink"
                />
                <input
                  value={draft.unit}
                  onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                  placeholder="单位"
                  className="w-20 bg-paper-dark border border-[var(--border-default)] rounded-[8px] px-3 py-1.5 text-sm outline-none focus:border-accent transition-all text-ink placeholder:text-ink-muted"
                />
              </div>
            </FieldRow>
          </SectionCard>

          <SectionCard label="时间">
            <FieldRow label="过期时间">
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={draft.expiresDate}
                  onChange={(e) => setDraft({ ...draft, expiresDate: e.target.value })}
                  className="flex-1 bg-transparent text-sm text-ink outline-none py-1"
                />
                {draft.expiresDate && (
                  <ExpiryBadge expiresAt={new Date(draft.expiresDate + 'T00:00:00').getTime()} />
                )}
              </div>
            </FieldRow>
            <FieldRow label="创建于">
              <span className="text-sm text-ink-muted">
                {new Date(item.updated_at).toLocaleDateString('zh-CN')}
              </span>
            </FieldRow>
          </SectionCard>

          <SectionCard label="描述">
            <div className="px-4 py-3">
              <label className="text-xs text-ink-muted block mb-1.5">备注</label>
              <textarea
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder="备注"
                rows={3}
                className="w-full bg-paper-dark border border-[var(--border-default)] rounded-[8px] px-3 py-2 text-sm resize-none outline-none focus:border-accent transition-all text-ink placeholder:text-ink-muted"
              />
            </div>
            <div className="px-4 py-3 border-t border-[var(--border-subtle)]">
              <label className="text-xs text-ink-muted block mb-1.5">标签（逗号分隔）</label>
              <input
                value={draft.tags}
                onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                placeholder="如 清洁用品, 备用"
                className="w-full bg-paper-dark border border-[var(--border-default)] rounded-[8px] px-3 py-2 text-sm outline-none focus:border-accent transition-all text-ink placeholder:text-ink-muted"
              />
            </div>
          </SectionCard>

          <SectionCard label="提醒">
            <ReminderSection itemId={itemId} />
          </SectionCard>

          <div className="flex gap-2">
            <button onClick={save} className="flex-1 py-2.5 rounded-[12px] bg-accent hover:bg-accent-hover text-paper font-medium shadow-card transition-all active:scale-[0.97]">保存</button>
            <button onClick={() => setEditing(false)} className="px-4 py-2.5 rounded-[12px] border border-[var(--border-default)] text-ink-muted hover:text-ink hover:border-ink/30 transition-all">取消</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center flex-wrap gap-1">
            <h1 className="text-2xl font-bold font-serif text-ink">{item.name}</h1>
            {item.expires_at != null && <ExpiryBadge expiresAt={item.expires_at} />}
          </div>

          {/* #180: 数量大字 + 快速加减按钮 */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => adjustQty(-1)}
              disabled={item.qty <= 0}
              className="w-9 h-9 flex items-center justify-center rounded-full border border-[var(--border-default)] text-ink-muted hover:border-accent hover:text-ink disabled:opacity-30 transition-all active:scale-95"
              aria-label="减少数量"
            >
              <Minus size={16} strokeWidth={1.5} />
            </button>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold font-serif text-ink">{item.qty}</span>
              <span className="text-ink-muted text-sm">{item.unit || '个'}</span>
            </div>
            <button
              onClick={() => adjustQty(+1)}
              className="w-9 h-9 flex items-center justify-center rounded-full border border-[var(--border-default)] text-ink-muted hover:border-accent hover:text-ink transition-all active:scale-95"
              aria-label="增加数量"
            >
              <Plus size={16} strokeWidth={1.5} />
            </button>
          </div>

          <div className="space-y-1 text-xs text-ink-muted">
            {item.created_at != null && (
              <p>创建于：{new Date(item.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
            )}
            {item.expires_at != null && (
              <p>过期时间：{new Date(item.expires_at).toLocaleDateString('zh-CN')}</p>
            )}
            {item.source !== 'manual' && (
              <p>来源：{item.source}{item.confidence != null && ` · 置信度 ${(item.confidence * 100).toFixed(0)}%`}</p>
            )}
          </div>

          {item.notes && (
            <p className="text-ink text-sm whitespace-pre-wrap bg-paper-card border border-[var(--border-default)] rounded-[12px] px-4 py-3">{item.notes}</p>
          )}

          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map(t => (
                <span key={t} className="text-xs px-2.5 py-1 rounded-full bg-paper-card border border-[var(--border-default)] text-ink-muted">{t}</span>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setEditing(true)}
              className="flex-1 py-2.5 rounded-[12px] border border-[var(--border-default)] hover:border-accent text-ink text-sm font-medium transition-all"
            >
              编辑
            </button>
            <button
              onClick={remove}
              className="px-4 py-2.5 rounded-[12px] border border-danger/30 text-danger-text hover:bg-danger-bg text-sm transition-all"
            >
              删除
            </button>
          </div>

          <ReminderSection itemId={itemId} />
        </>
      )}
    </div>
  );
}
