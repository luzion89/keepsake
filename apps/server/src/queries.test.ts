/**
 * Tests for applyPatch whitelist enforcement and listConflicts in queries.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { applyPatch, listConflicts, mergeUpsert, logConflict } from './db/queries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let tmpDir: string;
let db: Database.Database;

beforeEach(async () => {
  tmpDir = await mkdtemp(resolve(tmpdir(), 'keepsake-queries-test-'));
  const dbPath = resolve(tmpDir, 'test.sqlite');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const schema = readFileSync(resolve(__dirname, './db/schema.sql'), 'utf-8');
  db.exec(schema);
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

const ITEM_ID = 'aaaa0000-0000-4000-8000-000000000001';
const AREA_ID = 'bbbb0000-0000-4000-8000-000000000002';

function seedItem() {
  mergeUpsert(db, 'item', {
    id: ITEM_ID,
    area_id: AREA_ID,
    name: 'original',
    qty: 5,
    unit: '个',
    tags: [],
    photo_ids: [],
    source: 'manual',
    updated_at: 100,
    updated_by: 'devA',
    deleted: false,
    version: 0,
  });
}

describe('applyPatch — whitelist enforcement', () => {
  it('patches whitelisted scalar fields only', () => {
    seedItem();
    const result = applyPatch(db, 'item', ITEM_ID, { name: 'patched', qty: 10 }, 200, 'devB');
    expect(result).not.toBeNull();
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(ITEM_ID) as any;
    expect(row.name).toBe('patched');
    expect(row.qty).toBe(10);
  });

  it('silently strips non-whitelisted fields', () => {
    seedItem();
    // 'hacked' is not in the whitelist for item
    applyPatch(db, 'item', ITEM_ID, { name: 'patched', hacked: 'evil' } as any, 200, 'devB');
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(ITEM_ID) as any;
    expect((row as any).hacked).toBeUndefined();
    expect(row.name).toBe('patched');
  });

  it('returns null for unknown row id', () => {
    const result = applyPatch(db, 'item', 'nonexistent-id', { name: 'x' }, 100, 'devA');
    expect(result).toBeNull();
  });
});

describe('listConflicts', () => {
  it('returns conflicts ordered newest first', () => {
    seedItem();
    // log two fake conflicts
    logConflict(db, 'item', ITEM_ID, 'devA', { field: 'name', client: 'A', server: 'B' });
    logConflict(db, 'item', ITEM_ID, 'devB', { field: 'qty', client: 1, server: 2 });
    const rows = listConflicts(db);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // newest first
    expect(rows[0]!.created_at).toBeGreaterThanOrEqual(rows[1]!.created_at);
  });

  it('respects limit parameter', () => {
    seedItem();
    for (let i = 0; i < 5; i++) {
      logConflict(db, 'item', ITEM_ID, 'devA', { field: 'name', client: i, server: i + 1 });
    }
    const rows = listConflicts(db, 3);
    expect(rows.length).toBe(3);
  });
});
