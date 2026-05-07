-- Keepsake server schema (SQLite via better-sqlite3)
-- All domain tables share the same sync metadata columns:
--   id TEXT PK, updated_at INT, updated_by TEXT, deleted INT (0/1), version INT
-- JSON fields are stored as TEXT and parsed at boundary.

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  photo_ids TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rooms_updated_at ON rooms(updated_at);

CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  photo_ids TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS areas_updated_at ON areas(updated_at);
CREATE INDEX IF NOT EXISTS areas_room ON areas(room_id);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  unit TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  photo_ids TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER,
  source TEXT NOT NULL,
  confidence REAL,
  bbox TEXT,
  notes TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS items_updated_at ON items(updated_at);
CREATE INDEX IF NOT EXISTS items_area ON items(area_id);
CREATE INDEX IF NOT EXISTS items_name ON items(name);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  parent_type TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  blob_ref TEXT,
  remote_url TEXT,
  recognition_status TEXT NOT NULL DEFAULT 'pending',
  recognition_result TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS photos_updated_at ON photos(updated_at);
CREATE INDEX IF NOT EXISTS photos_parent ON photos(parent_type, parent_id);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  item_ids TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS snapshots_updated_at ON snapshots(updated_at);

CREATE TABLE IF NOT EXISTS conflict_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  field TEXT NOT NULL,
  client_value TEXT,
  server_value TEXT,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
