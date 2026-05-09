import type Database from 'better-sqlite3';
import {
  type Item, type Room, type Area, type Photo, type Snapshot, type ReminderRule,
  type TableName,
  mergeRoom, mergeArea, mergeItem, mergePhoto, mergeSnapshot, mergeReminderRule,
  mergeEncryptedItems, type EncryptedItem,
} from '@keepsake/shared';

// ---------- Row <-> Object encoding ----------
const JSON_FIELDS: Record<TableName, string[]> = {
  room: ['photo_ids'],
  area: ['photo_ids'],
  item: ['tags', 'photo_ids', 'bbox', 'enc_blob'],
  photo: ['recognition_result'],
  snapshot: ['item_ids'],
  reminder_rule: [],
};

function encode(table: TableName, row: any): any {
  const out: any = { ...row };
  out.deleted = row.deleted ? 1 : 0;
  for (const f of JSON_FIELDS[table]) {
    if (out[f] !== undefined && out[f] !== null) out[f] = JSON.stringify(out[f]);
  }
  return out;
}
function decode(table: TableName, row: any): any {
  if (!row) return row;
  const out: any = { ...row };
  out.deleted = !!row.deleted;
  for (const f of JSON_FIELDS[table]) {
    if (out[f] != null && typeof out[f] === 'string') {
      try { out[f] = JSON.parse(out[f]); } catch { /* ignore */ }
    }
  }
  return out;
}

// ---------- Generic CRUD ----------
const TABLE_MAP: Record<TableName, string> = {
  room: 'rooms',
  area: 'areas',
  item: 'items',
  photo: 'photos',
  snapshot: 'snapshots',
  reminder_rule: 'reminders',
};

// family_id is first non-PK column; all domain tables share this layout
const COLS: Record<TableName, string[]> = {
  room: ['id','family_id','name','icon','photo_ids','note','updated_at','updated_by','deleted','version'],
  area: ['id','family_id','room_id','name','photo_ids','note','updated_at','updated_by','deleted','version'],
  item: ['id','family_id','area_id','name','qty','unit','tags','photo_ids','expires_at','source','confidence','bbox','notes','enc_blob','updated_at','updated_by','deleted','version'],
  photo: ['id','family_id','parent_type','parent_id','taken_at','blob_ref','remote_url','recognition_status','recognition_result','updated_at','updated_by','deleted','version'],
  snapshot: ['id','family_id','area_id','taken_at','item_ids','note','updated_at','updated_by','deleted','version'],
  reminder_rule: ['id','family_id','item_id','kind','threshold_at','threshold_qty','note','last_fired_at','updated_at','updated_by','deleted','version'],
};

export function getRow(db: Database.Database, table: TableName, id: string, familyId?: string): any | null {
  const tbl = TABLE_MAP[table];
  if (familyId) {
    return decode(table, db.prepare(`SELECT * FROM ${tbl} WHERE id = ? AND family_id = ?`).get(id, familyId));
  }
  return decode(table, db.prepare(`SELECT * FROM ${tbl} WHERE id = ?`).get(id));
}

export function upsertRow(db: Database.Database, table: TableName, row: any) {
  const cols = COLS[table];
  const placeholders = cols.map(c => `@${c}`).join(',');
  const updates = cols.filter(c => c !== 'id').map(c => `${c}=excluded.${c}`).join(',');
  const sql = `INSERT INTO ${TABLE_MAP[table]} (${cols.join(',')}) VALUES (${placeholders})
               ON CONFLICT(id) DO UPDATE SET ${updates}`;
  const enc = encode(table, row);
  // ensure all cols exist on object
  for (const c of cols) if (!(c in enc)) enc[c] = null;
  db.prepare(sql).run(enc);
}

export function deleteRow(db: Database.Database, table: TableName, id: string, updated_at: number, updated_by: string, familyId?: string) {
  if (familyId) {
    db.prepare(`UPDATE ${TABLE_MAP[table]} SET deleted = 1, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND family_id = ?`)
      .run(updated_at, updated_by, id, familyId);
  } else {
    db.prepare(`UPDATE ${TABLE_MAP[table]} SET deleted = 1, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`)
      .run(updated_at, updated_by, id);
  }
}

export function changesSince(db: Database.Database, since: number, familyId?: string): Array<{table: TableName, row: any}> {
  const out: Array<{table: TableName, row: any}> = [];
  for (const table of Object.keys(TABLE_MAP) as TableName[]) {
    let rows: any[];
    if (familyId) {
      rows = db.prepare(`SELECT * FROM ${TABLE_MAP[table]} WHERE updated_at > ? AND family_id = ? ORDER BY updated_at ASC LIMIT 500`).all(since, familyId) as any[];
    } else {
      rows = db.prepare(`SELECT * FROM ${TABLE_MAP[table]} WHERE updated_at > ? ORDER BY updated_at ASC LIMIT 500`).all(since) as any[];
    }
    for (const r of rows) out.push({ table, row: decode(table, r) });
  }
  return out.sort((a, b) => a.row.updated_at - b.row.updated_at);
}

// ---------- Merge dispatch ----------
type MergeFn = (l: any, r: any) => { merged: any; conflicts: Array<{field:string;client:unknown;server:unknown}> };
const MERGE_FNS: Record<TableName, MergeFn> = {
  room: mergeRoom as MergeFn,
  area: mergeArea as MergeFn,
  item: mergeItem as MergeFn,
  photo: mergePhoto as MergeFn,
  snapshot: mergeSnapshot as MergeFn,
  reminder_rule: mergeReminderRule as MergeFn,
};

export function mergeUpsert(db: Database.Database, table: TableName, incoming: any, familyId?: string): { applied: any; conflicts: Array<{field:string;client:unknown;server:unknown}> } {
  // Enforce family_id on incoming row
  if (familyId) incoming = { ...incoming, family_id: familyId };

  const local = getRow(db, table, incoming.id, familyId);
  if (!local) {
    upsertRow(db, table, incoming);
    return { applied: incoming, conflicts: [] };
  }

  // Spike-C: if item has enc_blob, use field-level LWW merge (server never decrypts)
  if (table === 'item' && incoming.enc_blob && local.enc_blob) {
    const merged = mergeEncryptedItems(
      local as unknown as EncryptedItem,
      incoming as unknown as EncryptedItem,
    );
    if (familyId) (merged as any).family_id = familyId;
    upsertRow(db, table, merged);
    return { applied: merged, conflicts: [] };
  }

  const { merged, conflicts } = MERGE_FNS[table](local, incoming);
  if (familyId) (merged as any).family_id = familyId;
  upsertRow(db, table, merged);
  // merge-rules passes (local=server, remote=client), so conflict.client=server_val,
  // conflict.server=client_val — swap to match correct semantics (#158)
  const corrected = conflicts.map(c => ({ ...c, client: c.server, server: c.client }));
  return { applied: merged, conflicts: corrected };
}

export function logConflict(db: Database.Database, table: TableName, rowId: string, deviceId: string, conflict: {field:string;client:unknown;server:unknown}) {
  db.prepare(`INSERT INTO conflict_log (table_name, row_id, field, client_value, server_value, device_id, created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(table, rowId, conflict.field, JSON.stringify(conflict.client), JSON.stringify(conflict.server), deviceId, Date.now());
}
