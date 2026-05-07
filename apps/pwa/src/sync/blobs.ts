import { db, kvGet, kvSet } from '../db/dexie.js';

const BLOB_LAST_PULL_KEY = 'blob_last_pull';

/**
 * Push all local blobs to the server.
 * Tracks which blobs have been uploaded via the kv store (blob_uploaded:<id>).
 */
export async function pushPendingBlobs(): Promise<void> {
  const allBlobs = await db.blobs.toArray();
  for (const row of allBlobs) {
    const uploaded = await kvGet<boolean>(`blob_uploaded:${row.id}`);
    if (uploaded) continue;
    try {
      const form = new FormData();
      form.append('file', row.blob, row.id);
      const res = await fetch(`/blobs/${row.id}`, { method: 'PUT', body: form });
      if (res.ok) {
        await kvSet(`blob_uploaded:${row.id}`, true);
      }
    } catch {
      // Will retry next sync cycle
    }
  }
}

/**
 * Pull blobs from server that we don't have locally.
 */
export async function pullMissingBlobs(): Promise<void> {
  const since = (await kvGet<number>(BLOB_LAST_PULL_KEY)) ?? 0;
  let list: { ids: string[] };
  try {
    const res = await fetch(`/blobs/list?since=${since}`);
    if (!res.ok) return;
    list = await res.json();
  } catch {
    return;
  }

  for (const id of list.ids) {
    const existing = await db.blobs.get(id);
    if (existing) continue;
    try {
      const res = await fetch(`/blobs/id/${id}`);
      if (!res.ok) continue;
      const blob = await res.blob();
      await db.blobs.put({ id, blob });
    } catch {
      // Will retry next sync
    }
  }

  await kvSet(BLOB_LAST_PULL_KEY, Date.now());
}
