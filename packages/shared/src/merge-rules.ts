/**
 * Merge rules used identically on PWA client and Node server.
 * - Scalar fields: LWW by updated_at; ties broken by updated_by string compare.
 * - Arrays of ids/tags: union, with optional tombstone field `<field>_removed`.
 * - Item.qty: tracked via separate qty_delta ops (see sync-protocol). The
 *   `mergeItem` function does NOT touch qty when both sides come from upsert;
 *   absolute-value writes are reserved for explicit user "set to N" edits and
 *   resolved by LWW.
 * - deleted=true beats any concurrent edit.
 */

import type { Item, Room, Area, Photo, Snapshot, ReminderRule, SyncMeta } from './types.js';

export interface MergeOutcome<T> {
  merged: T;
  conflicts: Array<{ field: string; client: unknown; server: unknown }>;
}

function lwwPick(local: SyncMeta, remote: SyncMeta): 'local' | 'remote' {
  if (local.updated_at > remote.updated_at) return 'local';
  if (local.updated_at < remote.updated_at) return 'remote';
  // Tie: smaller deviceId wins (deterministic; same id → remote wins as fallback).
  if (local.updated_by < remote.updated_by) return 'local';
  if (local.updated_by > remote.updated_by) return 'remote';
  return 'remote'; // same updated_at + same updated_by → remote as final fallback
}

function unionArr<T>(a: T[] | undefined, b: T[] | undefined): T[] {
  return Array.from(new Set([...(a ?? []), ...(b ?? [])]));
}

function mergeScalar<T extends SyncMeta, K extends keyof T>(
  local: T,
  remote: T,
  field: K,
  conflicts: MergeOutcome<T>['conflicts'],
): T[K] {
  const lv = local[field];
  const rv = remote[field];
  // Treat null and undefined as equivalent ("no value") to avoid spurious
  // conflicts when one side comes from a JSON column read back as null and
  // the other from a typed object where the field is simply absent.
  const isEmpty = (v: unknown) => v === null || v === undefined;
  if (lv === rv || (isEmpty(lv) && isEmpty(rv))) return lv;
  const winner = lwwPick(local, remote);
  conflicts.push({
    field: String(field),
    client: lv,
    server: rv,
  });
  return winner === 'local' ? lv : rv;
}

function tombstoneCheck<T extends SyncMeta>(local: T, remote: T): T | null {
  if (local.deleted && !remote.deleted) return local;
  if (remote.deleted && !local.deleted) return remote;
  if (local.deleted && remote.deleted) {
    return lwwPick(local, remote) === 'local' ? local : remote;
  }
  return null;
}

export function mergeRoom(local: Room, remote: Room): MergeOutcome<Room> {
  const tomb = tombstoneCheck(local, remote);
  if (tomb) return { merged: tomb, conflicts: [] };
  const conflicts: MergeOutcome<Room>['conflicts'] = [];
  const merged: Room = {
    ...local,
    name: mergeScalar(local, remote, 'name', conflicts),
    icon: mergeScalar(local, remote, 'icon', conflicts),
    note: mergeScalar(local, remote, 'note', conflicts),
    photo_ids: unionArr(local.photo_ids, remote.photo_ids),
    updated_at: Math.max(local.updated_at, remote.updated_at),
    updated_by: lwwPick(local, remote) === 'local' ? local.updated_by : remote.updated_by,
    version: Math.max(local.version, remote.version) + 1,
  };
  return { merged, conflicts };
}

export function mergeArea(local: Area, remote: Area): MergeOutcome<Area> {
  const tomb = tombstoneCheck(local, remote);
  if (tomb) return { merged: tomb, conflicts: [] };
  const conflicts: MergeOutcome<Area>['conflicts'] = [];
  const merged: Area = {
    ...local,
    room_id: mergeScalar(local, remote, 'room_id', conflicts),
    name: mergeScalar(local, remote, 'name', conflicts),
    note: mergeScalar(local, remote, 'note', conflicts),
    photo_ids: unionArr(local.photo_ids, remote.photo_ids),
    updated_at: Math.max(local.updated_at, remote.updated_at),
    updated_by: lwwPick(local, remote) === 'local' ? local.updated_by : remote.updated_by,
    version: Math.max(local.version, remote.version) + 1,
  };
  return { merged, conflicts };
}

export function mergeItem(local: Item, remote: Item): MergeOutcome<Item> {
  const tomb = tombstoneCheck(local, remote);
  if (tomb) return { merged: tomb, conflicts: [] };
  const conflicts: MergeOutcome<Item>['conflicts'] = [];
  const merged: Item = {
    ...local,
    area_id: mergeScalar(local, remote, 'area_id', conflicts),
    name: mergeScalar(local, remote, 'name', conflicts),
    qty: mergeScalar(local, remote, 'qty', conflicts), // absolute-value LWW; deltas handled elsewhere
    unit: mergeScalar(local, remote, 'unit', conflicts),
    expires_at: mergeScalar(local, remote, 'expires_at', conflicts),
    notes: mergeScalar(local, remote, 'notes', conflicts),
    source: mergeScalar(local, remote, 'source', conflicts),
    confidence: mergeScalar(local, remote, 'confidence', conflicts),
    bbox: mergeScalar(local, remote, 'bbox', conflicts),
    tags: unionArr(local.tags, remote.tags),
    photo_ids: unionArr(local.photo_ids, remote.photo_ids),
    updated_at: Math.max(local.updated_at, remote.updated_at),
    updated_by: lwwPick(local, remote) === 'local' ? local.updated_by : remote.updated_by,
    version: Math.max(local.version, remote.version) + 1,
  };
  return { merged, conflicts };
}

export function applyQtyDelta(item: Item, delta: number, updated_at: number, updated_by: string): Item {
  return {
    ...item,
    qty: item.qty + delta,
    updated_at: Math.max(item.updated_at, updated_at),
    updated_by,
    version: item.version + 1,
  };
}

export function mergePhoto(local: Photo, remote: Photo): MergeOutcome<Photo> {
  const tomb = tombstoneCheck(local, remote);
  if (tomb) return { merged: tomb, conflicts: [] };
  const conflicts: MergeOutcome<Photo>['conflicts'] = [];
  const merged: Photo = {
    ...local,
    parent_type: mergeScalar(local, remote, 'parent_type', conflicts),
    parent_id: mergeScalar(local, remote, 'parent_id', conflicts),
    blob_ref: local.blob_ref ?? remote.blob_ref,
    remote_url: remote.remote_url ?? local.remote_url, // server-side url wins
    recognition_status:
      remote.recognition_status === 'done' ? 'done'
        : local.recognition_status === 'done' ? 'done'
        : mergeScalar(local, remote, 'recognition_status', conflicts),
    recognition_result: remote.recognition_result ?? local.recognition_result,
    updated_at: Math.max(local.updated_at, remote.updated_at),
    updated_by: lwwPick(local, remote) === 'local' ? local.updated_by : remote.updated_by,
    version: Math.max(local.version, remote.version) + 1,
  };
  return { merged, conflicts };
}

export function mergeSnapshot(local: Snapshot, remote: Snapshot): MergeOutcome<Snapshot> {
  // Snapshots are immutable in practice; LWW everything.
  const tomb = tombstoneCheck(local, remote);
  if (tomb) return { merged: tomb, conflicts: [] };
  return {
    merged: lwwPick(local, remote) === 'local' ? local : remote,
    conflicts: [],
  };
}

export function mergeReminderRule(local: ReminderRule, remote: ReminderRule): MergeOutcome<ReminderRule> {
  const tomb = tombstoneCheck(local, remote);
  if (tomb) return { merged: tomb, conflicts: [] };
  const conflicts: MergeOutcome<ReminderRule>['conflicts'] = [];
  const merged: ReminderRule = {
    ...local,
    item_id: mergeScalar(local, remote, 'item_id', conflicts),
    kind: mergeScalar(local, remote, 'kind', conflicts),
    threshold_at: mergeScalar(local, remote, 'threshold_at', conflicts),
    threshold_qty: mergeScalar(local, remote, 'threshold_qty', conflicts),
    note: mergeScalar(local, remote, 'note', conflicts),
    last_fired_at: Math.max(local.last_fired_at ?? 0, remote.last_fired_at ?? 0) || undefined,
    updated_at: Math.max(local.updated_at, remote.updated_at),
    updated_by: lwwPick(local, remote) === 'local' ? local.updated_by : remote.updated_by,
    version: Math.max(local.version, remote.version) + 1,
  };
  return { merged, conflicts };
}
