import { db, getDeviceId, kvGet, kvSet } from '../db/dexie.js';
import {
  type PullResp, type PushReq, type PushResp,
  mergeRoom, mergeArea, mergeItem, mergePhoto, mergeSnapshot, mergeReminderRule,
  type TableName,
} from '@keepsake/shared';
import { pullAiConfigFromServer } from '../ai/router.js';
import { pushPendingBlobs, pullMissingBlobs } from './blobs.js';
import { pushLogs, logger } from '../logging/logger.js';

const SYNC_CURSOR_KEY = 'sync_cursor';

export async function isServerReachable(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch('/health', { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

const MERGE: Record<TableName, (l: any, r: any) => { merged: any }> = {
  room: mergeRoom as any,
  area: mergeArea as any,
  item: mergeItem as any,
  photo: mergePhoto as any,
  snapshot: mergeSnapshot as any,
  reminder_rule: mergeReminderRule as any,
};
const TABLE_TO_DEXIE: Record<TableName, 'rooms'|'areas'|'items'|'photos'|'snapshots'|'reminders'> = {
  room: 'rooms', area: 'areas', item: 'items', photo: 'photos', snapshot: 'snapshots',
  reminder_rule: 'reminders',
};

async function applyRemote(changes: PullResp['changes']) {
  for (const c of changes) {
    const t = TABLE_TO_DEXIE[c.table];
    const row = c.row as any;
    const local = await (db as any)[t].get(row.id);
    if (!local) {
      await (db as any)[t].put(row);
    } else {
      const { merged } = MERGE[c.table](local, row);
      await (db as any)[t].put(merged);
    }
  }
}

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const RETRY_DELAYS_MS = [1_000, 2_000, 5_000];

/**
 * Attempt a fetch with simple exponential backoff.
 * Returns the Response on success, or null after all retries are exhausted.
 */
async function fetchWithRetry(input: RequestInfo, init?: RequestInit): Promise<Response | null> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.ok) return res;
      // Don't retry client errors (4xx)
      if (res.status >= 400 && res.status < 500) return null;
    } catch {
      // Network error — retry
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]!);
    }
  }
  return null;
}

let _running = false;
export async function syncOnce(): Promise<{ pushed: number; pulled: number; conflicts: number } | null> {
  if (_running) return null;
  if (!(await isServerReachable())) return null;
  _running = true;
  try {
    const since = (await kvGet<number>(SYNC_CURSOR_KEY)) ?? 0;

    // PUSH first (drain outbox) — ensures local changes reach the server
    // before we pull and apply remote state, minimising accidental overwrites.
    const pending = await db.outbox.orderBy('client_seq').limit(500).toArray();
    let pushed = 0, conflicts = 0;
    if (pending.length > 0) {
      const deviceId = await getDeviceId();
      const body: PushReq = { deviceId, ops: pending.map(p => p.op) };
      const pushRes = await fetchWithRetry('/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (pushRes) {
        const push = (await pushRes.json()) as PushResp;
        // record conflicts
        for (const c of push.conflicts) {
          await db.conflicts.add({
            table: c.table, row_id: c.id, field: c.field,
            client: c.client, server: c.server,
            seen_at: Date.now(), acknowledged: 0,
          });
          conflicts++;
        }
        // ack accepted ops
        await db.outbox.where('client_seq').belowOrEqual(pending[pending.length-1]!.client_seq).delete();
        pushed = pending.length;
      }
    }

    // PULL — apply remote changes after push so we see the server's merged state
    const pullRes = await fetchWithRetry(`/sync/pull?since=${since}`);
    if (!pullRes) return null;
    const pull = (await pullRes.json()) as PullResp;
    await applyRemote(pull.changes);

    await kvSet(SYNC_CURSOR_KEY, pull.serverTime);

    // Blob sync (after metadata sync)
    await pushPendingBlobs();
    await pullMissingBlobs();

    // Push client logs to server (best-effort)
    pushLogs().catch(() => {});

    return { pushed, pulled: pull.changes.length, conflicts };
  } finally {
    _running = false;
  }
}

export function startSyncDaemon() {
  // 启动时拉取服务端 AI 配置（LWW 合并，只读不写，避免循环）
  pullAiConfigFromServer().catch(() => {});
  syncOnce().catch(e => logger.error('sync_daemon', 'syncOnce failed', String(e)));
  window.addEventListener('online', () => syncOnce().catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncOnce().catch(() => {});
  });
  setInterval(() => syncOnce().catch(() => {}), 60_000);
}
