import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Plus, X } from 'lucide-react';
import type { Item, ReminderRule } from '@keepsake/shared';
import { ItemRepo, ReminderRepo } from '../db/repos.js';
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

function ReminderSection({ itemId }: { itemId: string }) {
  const [rules, setRules] = useState<ReminderRule[]>([]);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ReminderRule['kind']>('expiry');
  const [thresholdQty, setThresholdQty] = useState(1);
  const [recheckDaysStr, setRecheckDaysStr] = useState('30');
  const [note, setNote] = useState('');

  const reload = async () => {
    setRules(await ReminderRepo.listByItem(itemId));
  };
  useEffect(() => { reload(); }, [itemId]);

  const save = async () => {
    let threshold_at: number | undefined;
    let threshold_qty: number | undefined;
    if (kind === 'expiry') {
      threshold_at = 7 * 24 * 60 * 60 * 1000;
    } else if (kind === 'low_stock') {
      threshold_qty = thresholdQty;
    } else if (kind === 'recheck') {
      threshold_at = (Math.max(1, parseInt(recheckDaysStr, 10) || 30)) * 24 * 60 * 60 * 1000;
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

  const kindLabel = (k: ReminderRule['kind']) =>
    k === 'expiry' ? '过期提醒' : k === 'low_stock' ? '库存不足' : '定期检查';

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
        <div className="mx-4 mb-2 bg-paper-dark border border-[var(--border-default)] rounded-[12px] p-3 space-y-2 text-sm">
          <p className="text-xs text-ink-muted">提醒方式：打开 App 时页面横幅提示（暂不支持震动/音频/系统推送）</p>
          <select
            value={kind}
            onChange={e => setKind(e.target.value as ReminderRule['kind'])}
            className="w-full bg-paper-card border border-[var(--border-default)] rounded-[12px] px-3 py-2 outline-none focus:border-accent transition-all text-ink"
          >
            <option value="expiry">过期提醒（过期时间前 7 天）</option>
            <option value="low_stock">库存不足</option>
            <option value="recheck">定期检查</option>
          </select>
          {kind === 'low_stock' && (
            <div className="flex items-center gap-2">
              <span className="text-ink-muted text-xs w-20">库存阈值</span>
              <input
                type="number"
                min={0}
                value={thresholdQty}
                onChange={e => setThresholdQty(Number(e.target.value))}
                className="w-20 bg-paper-card border border-[var(--border-default)] rounded-[12px] px-3 py-1.5 outline-none focus:border-accent transition-all text-ink"
              />
            </div>
          )}
          {kind === 'recheck' && (
            <div className="flex items-center gap-2">
              <span className="text-ink-muted text-xs w-20">间隔天数</span>
              <input
                type="number"
                min={1}
                value={recheckDaysStr}
                onChange={e => setRecheckDaysStr(e.target.value)}
                onBlur={() => {
                  const n = parseInt(recheckDaysStr, 10);
                  setRecheckDaysStr(String(isNaN(n) || n < 1 ? 30 : n));
                }}
                className="w-20 bg-paper-card border border-[var(--border-default)] rounded-[12px] px-3 py-1.5 outline-none focus:border-accent transition-all text-ink"
              />
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
                {kindLabel(r.kind)}
                {r.threshold_qty != null && ` (≤${r.threshold_qty})`}
                {r.kind === 'recheck' && r.threshold_at != null && ` (每${Math.round(r.threshold_at / 86400000)}天)`}
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

  return (
    <div className="space-y-5">
      {dialog}
      <nav className="text-xs text-ink-muted">
        <Link to={`/areas/${item.area_id}`} className="hover:text-ink transition-colors flex items-center gap-1">
          <ChevronLeft size={14} strokeWidth={1.5} />
          返回区域
        </Link>
      </nav>

      {editing ? (
        /* ── 编辑模式（grouped sections）─────────────── */
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
        /* ── 查看模式 ─────────────────────────────────── */
        <>
          {/* 物品名 + 过期 badge */}
          <div className="flex items-center flex-wrap gap-1">
            <h1 className="text-2xl font-bold font-serif text-ink">{item.name}</h1>
            {item.expires_at != null && <ExpiryBadge expiresAt={item.expires_at} />}
          </div>

          {/* 数量大字展示 */}
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-bold font-serif text-ink">{item.qty}</span>
            <span className="text-ink-muted text-sm">{item.unit || '个'}</span>
          </div>

          {/* 元信息行 */}
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

          {/* 操作按钮 */}
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
