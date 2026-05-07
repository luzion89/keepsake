import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Item, Photo, ReminderRule } from '@keepsake/shared';
import { ItemRepo, PhotoRepo, ReminderRepo } from '../db/repos.js';
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
    return <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-rose-900/60 text-rose-300">已过期</span>;
  }
  if (days < 7) {
    return <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-rose-900/60 text-rose-300">剩 {days} 天</span>;
  }
  if (days <= 30) {
    return <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-300">剩 {days} 天</span>;
  }
  return <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-900/60 text-emerald-300">剩 {days} 天</span>;
}

function PhotoThumb({ photo }: { photo: Photo }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked: string | null = null;
    (async () => {
      if (photo.remote_url) { setUrl(photo.remote_url); return; }
      if (photo.blob_ref) {
        const b = await PhotoRepo.getBlob(photo.blob_ref);
        if (b) { revoked = URL.createObjectURL(b); setUrl(revoked); }
      }
    })();
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [photo.id]);
  if (!url) return <div className="w-full aspect-square bg-slate-800 rounded-xl" />;
  return <img src={url} alt="" className="w-full aspect-square object-cover rounded-xl" />;
}

function ReminderSection({ itemId }: { itemId: string }) {
  const [rules, setRules] = useState<ReminderRule[]>([]);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ReminderRule['kind']>('expiry');
  const [thresholdQty, setThresholdQty] = useState(1);
  const [recheckDays, setRecheckDays] = useState(30);
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
      threshold_at = recheckDays * 24 * 60 * 60 * 1000;
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
    <section className="border-t border-slate-800 pt-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">提醒规则</h2>
        <button
          onClick={() => setAdding(v => !v)}
          className="text-xs text-sky-400 hover:text-sky-300 transition-colors"
        >
          ➕ 添加提醒
        </button>
      </div>

      {adding && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2 text-sm">
          <select
            value={kind}
            onChange={e => setKind(e.target.value as ReminderRule['kind'])}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 outline-none focus:border-sky-400 transition-all"
          >
            <option value="expiry">过期提醒（有效期前 7 天）</option>
            <option value="low_stock">库存不足</option>
            <option value="recheck">定期检查</option>
          </select>
          {kind === 'low_stock' && (
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-xs w-20">库存阈值</span>
              <input
                type="number"
                min={0}
                value={thresholdQty}
                onChange={e => setThresholdQty(Number(e.target.value))}
                className="w-20 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 outline-none focus:border-sky-400 transition-all"
              />
            </div>
          )}
          {kind === 'recheck' && (
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-xs w-20">间隔天数</span>
              <input
                type="number"
                min={1}
                value={recheckDays}
                onChange={e => setRecheckDays(Number(e.target.value))}
                className="w-20 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 outline-none focus:border-sky-400 transition-all"
              />
            </div>
          )}
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="备注（可选）"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 outline-none focus:border-sky-400 transition-all"
          />
          <div className="flex gap-2">
            <button onClick={save} className="flex-1 px-3 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-medium transition-all">保存</button>
            <button onClick={() => setAdding(false)} className="px-3 py-2 rounded-xl border border-slate-800 text-slate-400 hover:text-slate-200 transition-all">取消</button>
          </div>
        </div>
      )}

      {rules.length > 0 && (
        <ul className="space-y-1">
          {rules.map(r => (
            <li key={r.id} className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs">
              <span className="flex-1 text-slate-200">
                {kindLabel(r.kind)}
                {r.threshold_qty != null && ` (≤${r.threshold_qty})`}
                {r.kind === 'recheck' && r.threshold_at != null && ` (每${Math.round(r.threshold_at / 86400000)}天)`}
                {r.note && <span className="text-slate-400 ml-1">— {r.note}</span>}
              </span>
              <button
                onClick={() => remove(r.id)}
                className="text-slate-600 hover:text-rose-400 transition-colors"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ItemPage() {
  const { itemId = '' } = useParams();
  const [item, setItem] = useState<Item | undefined>();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: '', qty: 0, notes: '', expiresDate: '' });
  const { confirm, dialog } = useConfirm();

  const reload = async () => {
    const it = await db.items.get(itemId);
    setItem(it);
    if (it) {
      setDraft({ name: it.name, qty: it.qty, notes: it.notes ?? '', expiresDate: it.expires_at ? new Date(it.expires_at).toISOString().slice(0, 10) : '' });
      const ps = await PhotoRepo.listFor('area', it.area_id);
      setPhotos(ps);
    }
  };
  useEffect(() => { reload(); }, [itemId]);

  if (!item) return <p className="text-slate-400">加载中…</p>;

  const save = async () => {
    const expires_at = draft.expiresDate
      ? new Date(draft.expiresDate + 'T00:00:00').getTime()
      : undefined;
    await ItemRepo.update(item.id, { name: draft.name, qty: draft.qty, notes: draft.notes, expires_at });
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
      <nav className="text-xs text-slate-500">
        <Link to={`/areas/${item.area_id}`} className="hover:text-slate-300 transition-colors">← 返回区域</Link>
      </nav>

      {editing ? (
        /* ── 编辑模式 ─────────────────────────────────── */
        <div className="space-y-3">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-lg font-medium outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 transition-all"
          />
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 w-12">数量</span>
            <input
              type="number"
              value={draft.qty}
              onChange={(e) => setDraft({ ...draft, qty: Number(e.target.value) })}
              className="w-24 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm outline-none focus:border-sky-400 transition-all"
            />
          </div>
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="备注"
            rows={3}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm resize-none outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 transition-all"
          />
          <div className="space-y-1.5">
            <label className="block text-xs text-slate-500">有效期（用于过期提醒，可选）</label>
            <input
              type="date"
              value={draft.expiresDate}
              onChange={(e) => setDraft({ ...draft, expiresDate: e.target.value })}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm outline-none focus:border-sky-400 transition-all"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-medium shadow-lg shadow-sky-500/20 transition-all active:scale-[0.97]">保存</button>
            <button onClick={() => setEditing(false)} className="px-4 py-2.5 rounded-xl border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 transition-all">取消</button>
          </div>
        </div>
      ) : (
        /* ── 查看模式 ─────────────────────────────────── */
        <>
          {/* 物品名 + 过期 badge */}
          <div className="flex items-center flex-wrap gap-1">
            <h1 className="text-2xl font-bold text-slate-100">{item.name}</h1>
            {item.expires_at != null && <ExpiryBadge expiresAt={item.expires_at} />}
          </div>

          {/* 数量大字展示 */}
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-bold text-sky-400">{item.qty}</span>
            {item.unit && <span className="text-slate-400 text-sm">{item.unit}</span>}
          </div>

          {/* 元信息行 */}
          <div className="space-y-1 text-xs text-slate-500">
            {item.expires_at != null && (
              <p>有效期：{new Date(item.expires_at).toLocaleDateString('zh-CN')}</p>
            )}
            {item.source !== 'manual' && (
              <p>来源：{item.source}{item.confidence != null && ` · 置信度 ${(item.confidence * 100).toFixed(0)}%`}</p>
            )}
          </div>

          {item.notes && (
            <p className="text-slate-300 text-sm whitespace-pre-wrap bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">{item.notes}</p>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(true)}
              className="flex-1 py-2.5 rounded-xl border border-slate-700 hover:border-sky-500 text-slate-100 text-sm font-medium transition-all"
            >
              编辑
            </button>
            <button
              onClick={remove}
              className="px-4 py-2.5 rounded-xl border border-rose-800 text-rose-400 hover:bg-rose-950 text-sm transition-all"
            >
              删除
            </button>
          </div>
        </>
      )}

      <ReminderSection itemId={itemId} />

      {photos.length > 0 && (
        <section className="border-t border-slate-800 pt-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">区域里的照片</h2>
          <div className="grid grid-cols-3 gap-2">
            {photos.map(p => <PhotoThumb key={p.id} photo={p} />)}
          </div>
        </section>
      )}
    </div>
  );
}
