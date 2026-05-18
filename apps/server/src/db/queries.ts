import type Database from 'better-sqlite3';
import {
  type Item, type Room, type Area, type Photo, type Snapshot, type ReminderRule,
  type TableName,
  mergeRoom, mergeArea, mergeItem, mergePhoto, mergeSnapshot, mergeReminderRule,
} from '@keepsake/shared';

// ---------- Row <-> Object encoding ----------
const JSON_FIELDS: Record<TableName, string[]> = {
  room: ['photo_ids'],
  area: ['photo_ids'],
  item: ['tags', 'photo_ids', 'bbox'],
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

const COLS: Record<TableName, string[]> = {
  room: ['id','name','icon','photo_ids','note','updated_at','updated_by','deleted','version'],
  area: ['id','room_id','name','photo_ids','note','updated_at','updated_by','deleted','version'],
  item: ['id','area_id','name','qty','unit','tags','photo_ids','expires_at','source','confidence','bbox','notes','updated_at','updated_by','deleted','version'],
  photo: ['id','parent_type','parent_id','taken_at','blob_ref','remote_url','recognition_status','recognition_result','updated_at','updated_by','deleted','version'],
  snapshot: ['id','area_id','taken_at','item_ids','note','updated_at','updated_by','deleted','version'],
  reminder_rule: ['id','item_id','kind','threshold_at','threshold_qty','note','last_fired_at','updated_at','updated_by','deleted','version'],
};

export function getRow(db: Database.Database, table: TableName, id: string): any | null {
  const stmt = db.prepare(`SELECT * FROM ${TABLE_MAP[table]} WHERE id = ?`);
  return decode(table, stmt.get(id));
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

export function deleteRow(db: Database.Database, table: TableName, id: string, updated_at: number, updated_by: string) {
  db.prepare(`UPDATE ${TABLE_MAP[table]} SET deleted = 1, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`)
    .run(updated_at, updated_by, id);
}

export function changesSince(db: Database.Database, since: number): Array<{table: TableName, row: any}> {
  const out: Array<{table: TableName, row: any}> = [];
  for (const table of Object.keys(TABLE_MAP) as TableName[]) {
    const rows = db.prepare(`SELECT * FROM ${TABLE_MAP[table]} WHERE updated_at > ? ORDER BY updated_at ASC LIMIT 500`).all(since) as any[];
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

export function mergeUpsert(db: Database.Database, table: TableName, incoming: any): { applied: any; conflicts: Array<{field:string;client:unknown;server:unknown}> } {
  const local = getRow(db, table, incoming.id);
  if (!local) {
    upsertRow(db, table, incoming);
    return { applied: incoming, conflicts: [] };
  }
  const { merged, conflicts } = MERGE_FNS[table](local, incoming);
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

export interface ConflictLogRow {
  id: number;
  table_name: string;
  row_id: string;
  field: string;
  client_value: string | null;
  server_value: string | null;
  device_id: string;
  created_at: number;
}

/** Return all conflict_log rows, newest first. Limit defaults to 200. */
export function listConflicts(db: Database.Database, limit = 200): ConflictLogRow[] {
  return db.prepare(
    'SELECT * FROM conflict_log ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as ConflictLogRow[];
}

/** Apply a qty delta to an existing item row in a single DB write. */
export function applyQtyDelta(
  db: Database.Database,
  itemId: string,
  delta: number,
  updated_at: number,
  deviceId: string,
): boolean {
  const local = getRow(db, 'item', itemId);
  if (!local) return false;
  local.qty = (local.qty ?? 0) + delta;
  local.updated_at = Math.max(local.updated_at, updated_at);
  local.updated_by = deviceId;
  local.version = (local.version ?? 0) + 1;
  mergeUpsert(db, 'item', local);
  return true;
}

/** Allowed patch fields per table (whitelist). Fields outside this set are silently stripped. */
const PATCH_WHITELIST: Record<TableName, Set<string>> = {
  room: new Set(['name', 'icon', 'note']),
  area: new Set(['name', 'note']),
  item: new Set(['name', 'qty', 'unit', 'notes', 'expires_at', 'source', 'confidence', 'bbox', 'tags', 'photo_ids']),
  photo: new Set(['recognition_status', 'recognition_result', 'remote_url', 'blob_ref']),
  snapshot: new Set(['note']),
  reminder_rule: new Set(['kind', 'threshold_at', 'threshold_qty', 'note', 'last_fired_at']),
};

/**
 * Apply a patch op to a row in the DB, filtering to whitelist fields only.
 * Returns the conflicts produced by the merge (if any).
 * Returns null if the row does not exist.
 */
export function applyPatch(
  db: Database.Database,
  table: TableName,
  id: string,
  fields: Record<string, unknown>,
  updated_at: number,
  updated_by: string,
): { conflicts: Array<{field:string;client:unknown;server:unknown}> } | null {
  const local = getRow(db, table, id);
  if (!local) return null;

  // Strip non-whitelisted fields
  const whitelist = PATCH_WHITELIST[table];
  const safeFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (whitelist.has(k)) safeFields[k] = v;
  }

  const synthetic = {
    ...local,
    ...safeFields,
    updated_at,
    updated_by,
    version: local.version + 1,
  };
  const { conflicts } = mergeUpsert(db, table, synthetic);
  return { conflicts };
}
