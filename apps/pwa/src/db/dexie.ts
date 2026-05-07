import Dexie, { type Table } from 'dexie';
import type { Room, Area, Item, Photo, Snapshot, ReminderRule } from '@keepsake/shared';

export interface OutboxRow {
  client_seq: number;          // pk
  enqueued_at: number;
  op: any;                     // serialized Op
}

export interface ConflictRow {
  id?: number;                 // autoinc pk
  table: string;
  row_id: string;
  field: string;
  client: unknown;
  server: unknown;
  seen_at: number;
  acknowledged: 0 | 1;
}

export interface BlobRow {
  id: string;                  // photo id
  blob: Blob;
}

export interface KvRow {
  key: string;
  value: unknown;
}

export class KeepsakeDB extends Dexie {
  rooms!: Table<Room, string>;
  areas!: Table<Area, string>;
  items!: Table<Item, string>;
  photos!: Table<Photo, string>;
  snapshots!: Table<Snapshot, string>;
  outbox!: Table<OutboxRow, number>;
  conflicts!: Table<ConflictRow, number>;
  blobs!: Table<BlobRow, string>;
  kv!: Table<KvRow, string>;
  reminders!: Table<ReminderRule, string>;

  constructor() {
    super('keepsake');
    this.version(1).stores({
      rooms: 'id, name, updated_at, deleted',
      areas: 'id, room_id, name, updated_at, deleted',
      items: 'id, area_id, name, updated_at, deleted, *tags',
      photos: 'id, parent_type, parent_id, updated_at, recognition_status, deleted',
      snapshots: 'id, area_id, taken_at, updated_at, deleted',
      outbox: '++client_seq, enqueued_at',
      conflicts: '++id, table, row_id, seen_at, acknowledged',
      blobs: 'id',
      kv: 'key',
    });
    this.version(2).stores({
      reminders: 'id, item_id, kind, updated_at, deleted',
    }).upgrade(() => { /* no data migration needed */ });
  }
}

export const db = new KeepsakeDB();

// --- KV helpers ---
export async function kvGet<T = unknown>(key: string): Promise<T | undefined> {
  const row = await db.kv.get(key);
  return row?.value as T | undefined;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}

// --- Device id ---
export async function getDeviceId(): Promise<string> {
  let id = await kvGet<string>('device_id');
  if (!id) {
    id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    await kvSet('device_id', id);
  }
  return id;
}
