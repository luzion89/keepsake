import { db, kvGet, kvSet } from '../db/dexie.js';

const BLOB_LAST_PULL_KEY = 'blob_last_pull';
const SERVER_URL_KEY = 'server_url';

async function getServerBase(): Promise<string> {
  const url = await kvGet<string>(SERVER_URL_KEY);
  return url?.trim() || '';
}

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
      const res = await fetch(`${await getServerBase()}/blobs/${row.id}`, { method: 'PUT', body: form });
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
    const res = await fetch(`${await getServerBase()}/blobs/list?since=${since}`);
    if (!res.ok) return;
    list = await res.json();
  } catch {
    return;
  }

  for (const id of list.ids) {
    const existing = await db.blobs.get(id);
    if (existing) continue;
    try {
      const res = await fetch(`${await getServerBase()}/blobs/id/${id}`);
      if (!res.ok) continue;
      const blob = await res.blob();
      await db.blobs.put({ id, blob });
    } catch {
      // Will retry next sync
    }
  }

  await kvSet(BLOB_LAST_PULL_KEY, Date.now());
}

/**
 * GC: delete local blobs that have been synced to the server AND are no longer
 * referenced by any photo record (including soft-deleted ones, for safety).
 *
 * A blob is safe to remove locally when:
 *   1. `blob_uploaded:<id>` KV flag is truthy  → already on the server
 *   2. No photo row has `id === blobId`        → not referenced anymore
 *
 * Returns the number of blobs deleted.
 * Closes #50
 */
export async function gcSyncedBlobs(): Promise<number> {
  const allBlobs = await db.blobs.toArray();
  // Build a set of photo ids (including soft-deleted) so we never delete a
  // blob that is still pointed to by a photo row.
  const allPhotos = await db.photos.toArray();
  const referencedIds = new Set(allPhotos.map(p => p.id));

  let deleted = 0;
  for (const row of allBlobs) {
    if (referencedIds.has(row.id)) continue; // still referenced
    const uploaded = await kvGet<boolean>(`blob_uploaded:${row.id}`);
    if (!uploaded) continue; // not yet synced — keep it
    await db.blobs.delete(row.id);
    deleted++;
  }
  return deleted;
}
