import { db, getDeviceId } from './dexie.js';
import type { Room, Area, Item, Photo, Snapshot, ReminderRule, TableName } from '@keepsake/shared';
import { v4 as uuid } from 'uuid';

async function meta(updated_by?: string) {
  return {
    updated_at: Date.now(),
    updated_by: updated_by ?? (await getDeviceId()),
    deleted: false,
    version: 0,
  };
}

async function enqueue(table: TableName, row: any) {
  await db.outbox.add({
    enqueued_at: Date.now(),
    op: { kind: 'upsert', table, row },
  } as any);
}

// Array fields per table — if any changed field is in this set, fallback to upsert
const ARRAY_FIELDS: Record<TableName, Set<string>> = {
  room: new Set(['photo_ids']),
  area: new Set(['photo_ids']),
  item: new Set(['tags', 'photo_ids', 'bbox']),
  photo: new Set([]),
  snapshot: new Set(['item_ids']),
  reminder_rule: new Set([]),
};

/** Returns only the keys that actually changed (array fields: always considered changed if present) */
function diffPatch<T extends object>(cur: T, input: Partial<T>): Partial<T> {
  const out: any = {};
  for (const k of Object.keys(input) as (keyof T)[]) {
    const v = input[k];
    if (Array.isArray(cur[k]) || Array.isArray(v)) {
      // For arrays use JSON comparison to detect real changes
      if (JSON.stringify(cur[k]) !== JSON.stringify(v)) out[k] = v;
    } else if (cur[k] !== v) {
      out[k] = v;
    }
  }
  return out;
}

async function enqueuePatch(table: TableName, cur: any, changed: Record<string, unknown>, updated_at: number, updated_by: string) {
  // Check if any changed field is an array field → fallback upsert
  const arrayFields = ARRAY_FIELDS[table];
  const hasArray = Object.keys(changed).some(k => arrayFields.has(k));
  if (hasArray) {
    // fallback: caller should enqueue upsert
    return false;
  }
  await db.outbox.add({
    enqueued_at: Date.now(),
    op: { kind: 'patch', table, id: cur.id, fields: changed, updated_at, updated_by, base_version: cur.version },
  } as any);
  return true;
}

async function enqueueDelete(table: TableName, id: string, updated_at: number) {
  await db.outbox.add({
    enqueued_at: Date.now(),
    op: { kind: 'delete', table, id, updated_at },
  } as any);
}

// ---------- Rooms ----------
export const RoomRepo = {
  async list(): Promise<Room[]> {
    return (await db.rooms.toArray()).filter(r => !r.deleted);
  },
  async get(id: string): Promise<Room | undefined> { return db.rooms.get(id); },
  async create(input: { name: string; icon?: string; note?: string }): Promise<Room> {
    const m = await meta();
    const row: Room = { id: uuid(), photo_ids: [], ...input, ...m };
    await db.rooms.put(row);
    await enqueue('room', row);
    return row;
  },
  async update(id: string, patch: Partial<Pick<Room, 'name' | 'icon' | 'note'>>) {
    const cur = await db.rooms.get(id); if (!cur) return;
    const m = await meta();
    const next: Room = { ...cur, ...patch, ...m, version: cur.version + 1 };
    await db.rooms.put(next);
    const changed = diffPatch(cur, patch as Partial<Room>);
    if (Object.keys(changed).length === 0) return;
    const patched = await enqueuePatch('room', cur, changed as Record<string, unknown>, m.updated_at, m.updated_by);
    if (!patched) await enqueue('room', next);
  },
  async remove(id: string) {
    const cur = await db.rooms.get(id); if (!cur) return;
    const next = { ...cur, deleted: true, updated_at: Date.now(), updated_by: await getDeviceId(), version: cur.version + 1 };
    await db.rooms.put(next);
    await enqueueDelete('room', id, next.updated_at);
  },
};

// ---------- Areas ----------
export const AreaRepo = {
  async listByRoom(roomId: string): Promise<Area[]> {
    return (await db.areas.where('room_id').equals(roomId).toArray()).filter(a => !a.deleted);
  },
  async get(id: string): Promise<Area | undefined> { return db.areas.get(id); },
  async create(input: { room_id: string; name: string; note?: string }): Promise<Area> {
    const m = await meta();
    const row: Area = { id: uuid(), photo_ids: [], ...input, ...m };
    await db.areas.put(row);
    await enqueue('area', row);
    return row;
  },
  async update(id: string, patch: Partial<Pick<Area, 'name' | 'note'>>) {
    const cur = await db.areas.get(id); if (!cur) return;
    const m = await meta();
    const next: Area = { ...cur, ...patch, ...m, version: cur.version + 1 };
    await db.areas.put(next);
    const changed = diffPatch(cur, patch as Partial<Area>);
    if (Object.keys(changed).length === 0) return;
    const patched = await enqueuePatch('area', cur, changed as Record<string, unknown>, m.updated_at, m.updated_by);
    if (!patched) await enqueue('area', next);
  },
  async remove(id: string) {
    const cur = await db.areas.get(id); if (!cur) return;
    const next = { ...cur, deleted: true, updated_at: Date.now(), updated_by: await getDeviceId(), version: cur.version + 1 };
    await db.areas.put(next);
    await enqueueDelete('area', id, next.updated_at);
  },
};

// ---------- Items ----------
export const ItemRepo = {
  async listByArea(areaId: string): Promise<Item[]> {
    return (await db.items.where('area_id').equals(areaId).toArray()).filter(i => !i.deleted);
  },
  async search(query: string): Promise<Item[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const all = await db.items.toArray();
    return all.filter(i => !i.deleted && (
      i.name.toLowerCase().includes(q) ||
      (i.notes ?? '').toLowerCase().includes(q) ||
      i.tags.some(t => t.toLowerCase().includes(q))
    ));
  },
  async create(input: { area_id: string; name: string; qty?: number; unit?: string; tags?: string[]; source?: Item['source']; notes?: string; photo_ids?: string[]; confidence?: number; expires_at?: number; }): Promise<Item> {
    const m = await meta();
    const row: Item = {
      id: uuid(),
      area_id: input.area_id,
      name: input.name,
      qty: input.qty ?? 1,
      unit: input.unit ?? '个',
      tags: input.tags ?? [],
      photo_ids: input.photo_ids ?? [],
      source: input.source ?? 'manual',
      confidence: input.confidence,
      notes: input.notes,
      expires_at: input.expires_at,
      created_at: Date.now(),
      ...m,
    };
    await db.items.put(row);
    await enqueue('item', row);
    return row;
  },
  async update(id: string, patch: Partial<Item>) {
    const cur = await db.items.get(id); if (!cur) return;
    const m = await meta();
    const next: Item = { ...cur, ...patch, ...m, version: cur.version + 1 };
    await db.items.put(next);
    const changed = diffPatch(cur, patch);
    if (Object.keys(changed).length === 0) return;
    const patched = await enqueuePatch('item', cur, changed as Record<string, unknown>, m.updated_at, m.updated_by);
    if (!patched) await enqueue('item', next);
  },
  async qtyDelta(id: string, delta: number) {
    const cur = await db.items.get(id); if (!cur) return;
    const updated_at = Date.now();
    const next: Item = { ...cur, qty: cur.qty + delta, updated_at, updated_by: await getDeviceId(), version: cur.version + 1 };
    await db.items.put(next);
    await db.outbox.add({ enqueued_at: Date.now(), op: { kind: 'qty_delta', itemId: id, delta, updated_at } } as any);
  },
  async remove(id: string) {
    const cur = await db.items.get(id); if (!cur) return;
    const next = { ...cur, deleted: true, updated_at: Date.now(), updated_by: await getDeviceId(), version: cur.version + 1 };
    await db.items.put(next);
    await enqueueDelete('item', id, next.updated_at);
  },
};

// ---------- Photos ----------
export const PhotoRepo = {
  async create(parent: { type: 'room'|'area'|'item'; id: string }, blob: Blob): Promise<Photo> {
    const id = uuid();
    await db.blobs.put({ id, blob });
    const m = await meta();
    const row: Photo = {
      id,
      parent_type: parent.type,
      parent_id: parent.id,
      taken_at: Date.now(),
      blob_ref: id,
      recognition_status: 'pending',
      ...m,
    };
    await db.photos.put(row);
    await enqueue('photo', row);
    return row;
  },
  async getBlob(id: string): Promise<Blob | undefined> {
    const row = await db.blobs.get(id);
    return row?.blob;
  },
  async listFor(parentType: 'room'|'area'|'item', parentId: string): Promise<Photo[]> {
    return (await db.photos.where('parent_id').equals(parentId).toArray())
      .filter(p => p.parent_type === parentType && !p.deleted);
  },
  async setRecognition(id: string, status: Photo['recognition_status'], result?: unknown) {
    const cur = await db.photos.get(id); if (!cur) return;
    const m = await meta();
    const next: Photo = { ...cur, recognition_status: status, recognition_result: result, ...m, version: cur.version + 1 };
    await db.photos.put(next);
    const patch: Partial<Photo> = { recognition_status: status, recognition_result: result };
    const changed = diffPatch(cur, patch);
    if (Object.keys(changed).length === 0) return;
    const patched = await enqueuePatch('photo', cur, changed as Record<string, unknown>, m.updated_at, m.updated_by);
    if (!patched) await enqueue('photo', next);
  },
  async remove(id: string) {
    const cur = await db.photos.get(id); if (!cur) return;
    const next = { ...cur, deleted: true, updated_at: Date.now(), updated_by: await getDeviceId(), version: cur.version + 1 };
    await db.photos.put(next);
    await enqueueDelete('photo', id, next.updated_at);
    // 同步删除本地 blob
    await db.blobs.delete(id).catch(() => {});
  },
};

// ---------- Snapshots ----------
export const SnapshotRepo = {
  async create(input: { area_id: string; taken_at: number; item_ids: string[]; note?: string }): Promise<Snapshot> {
    const m = await meta();
    const row: Snapshot = { id: uuid(), ...input, ...m };
    await db.snapshots.put(row);
    await enqueue('snapshot', row);
    return row;
  },
  async listByArea(areaId: string): Promise<Snapshot[]> {
    return (await db.snapshots.where('area_id').equals(areaId).toArray()).filter(s => !s.deleted);
  },
};

// ---------- Reminders ----------
export const ReminderRepo = {
  async listByItem(itemId: string): Promise<ReminderRule[]> {
    return (await db.reminders.where('item_id').equals(itemId).toArray()).filter(r => !r.deleted);
  },
  async listAll(): Promise<ReminderRule[]> {
    return (await db.reminders.toArray()).filter(r => !r.deleted);
  },
  async create(input: {
    item_id: string;
    kind: ReminderRule['kind'];
    threshold_at?: number;
    threshold_qty?: number;
    note?: string;
  }): Promise<ReminderRule> {
    const m = await meta();
    const row: ReminderRule = { id: uuid(), ...input, ...m };
    await db.reminders.put(row);
    await enqueue('reminder_rule', row);
    return row;
  },
  async updateFired(id: string) {
    const cur = await db.reminders.get(id); if (!cur) return;
    const m = await meta();
    const last_fired_at = Date.now();
    const next: ReminderRule = { ...cur, last_fired_at, ...m, version: cur.version + 1 };
    await db.reminders.put(next);
    const changed = diffPatch(cur, { last_fired_at });
    if (Object.keys(changed).length === 0) return;
    const patched = await enqueuePatch('reminder_rule', cur, changed as Record<string, unknown>, m.updated_at, m.updated_by);
    if (!patched) await enqueue('reminder_rule', next);
  },
  async remove(id: string) {
    const cur = await db.reminders.get(id); if (!cur) return;
    const next = { ...cur, deleted: true, updated_at: Date.now(), updated_by: await getDeviceId(), version: cur.version + 1 };
    await db.reminders.put(next);
    await enqueueDelete('reminder_rule', id, next.updated_at);
  },
};
