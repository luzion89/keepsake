import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Item, Photo } from '@keepsake/shared';
import { ItemRepo, PhotoRepo } from '../db/repos.js';
import { db } from '../db/dexie.js';
import { useConfirm } from '../components/ConfirmDialog.js';

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
  if (!url) return <div className="w-full aspect-square bg-slate-800 rounded-lg" />;
  return <img src={url} alt="" className="w-full aspect-square object-cover rounded-lg" />;
}

export function ItemPage() {
  const { itemId = '' } = useParams();
  const [item, setItem] = useState<Item | undefined>();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: '', qty: 0, notes: '' });
  const { confirm, dialog } = useConfirm();

  const reload = async () => {
    const it = await db.items.get(itemId);
    setItem(it);
    if (it) {
      setDraft({ name: it.name, qty: it.qty, notes: it.notes ?? '' });
      const ps = await PhotoRepo.listFor('area', it.area_id);
      setPhotos(ps);
    }
  };
  useEffect(() => { reload(); }, [itemId]);

  if (!item) return <p className="text-slate-400">加载中…</p>;

  const save = async () => {
    await ItemRepo.update(item.id, { name: draft.name, qty: draft.qty, notes: draft.notes });
    setEditing(false);
    await reload();
  };

  const remove = async () => {
    if (!await confirm(`删除 "${item.name}"?`, { danger: true, okText: '删除' })) return;
    await ItemRepo.remove(item.id);
    history.back();
  };

  return (
    <div className="space-y-4">
      {dialog}
      <div className="text-sm text-slate-400">
        <Link to={`/areas/${item.area_id}`} className="hover:text-white">← 返回区域</Link>
      </div>

      {editing ? (
        <div className="space-y-2">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-lg font-medium"
          />
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400 w-12">数量</span>
            <input
              type="number"
              value={draft.qty}
              onChange={(e) => setDraft({ ...draft, qty: Number(e.target.value) })}
              className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            />
          </div>
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="备注"
            rows={3}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
          />
          <div className="flex gap-2">
            <button onClick={save} className="flex-1 px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-medium">保存</button>
            <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-lg border border-slate-700">取消</button>
          </div>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{item.name}</h1>
          <p className="text-slate-300">数量 {item.qty}{item.unit ? ' ' + item.unit : ''}</p>
          {item.notes && <p className="text-slate-400 text-sm whitespace-pre-wrap">{item.notes}</p>}
          {item.source !== 'manual' && (
            <p className="text-xs text-slate-500">来源 {item.source}{item.confidence != null && ` · 置信度 ${(item.confidence * 100).toFixed(0)}%`}</p>
          )}
          <div className="flex gap-2">
            <button onClick={() => setEditing(true)} className="flex-1 px-4 py-2 rounded-lg border border-slate-700 hover:border-sky-500">编辑</button>
            <button onClick={remove} className="px-4 py-2 rounded-lg border border-rose-700 text-rose-300">删除</button>
          </div>
        </>
      )}

      {photos.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">区域里的照片</h2>
          <div className="grid grid-cols-3 gap-2">
            {photos.map(p => <PhotoThumb key={p.id} photo={p} />)}
          </div>
        </section>
      )}
    </div>
  );
}
