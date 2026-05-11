import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from './index.js';
import { rmSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';

const TEST_DB = './data/test-patch-op.sqlite';
const AREA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function itemBase(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    area_id: AREA_ID,
    name: 'original',
    qty: 1,
    unit: '个',
    tags: [],
    photo_ids: [],
    source: 'manual',
    updated_at: 500,
    updated_by: 'devA',
    deleted: false,
    version: 0,
    ...overrides,
  };
}

describe('patch op — server', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.KEEPSAKE_DB = TEST_DB;
    try { rmSync(TEST_DB, { force: true }); } catch {}
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    try { rmSync(TEST_DB, { force: true }); } catch {}
  });

  // 场景 1：patch name，qty 不变
  it('场景1: patch name, qty should remain unchanged', async () => {
    const id = '11111111-0001-4000-8000-000000000001';
    // First upsert the item
    await app.inject({
      method: 'POST', url: '/sync/push',
      payload: { deviceId: 'devA', ops: [{ kind: 'upsert', table: 'item', row: itemBase(id) }] },
    });
    // Now patch name
    const push = await app.inject({
      method: 'POST', url: '/sync/push',
      payload: { deviceId: 'devA', ops: [{ kind: 'patch', table: 'item', id, fields: { name: 'X' }, updated_at: 1000, updated_by: 'devA', base_version: 0 }] },
    });
    expect(push.statusCode).toBe(200);
    expect(push.json().accepted).toContain(id);
    // Verify via pull
    const pull = await app.inject({ url: '/sync/pull?since=0' });
    const item = pull.json().changes.find((c: any) => c.table === 'item' && c.row.id === id);
    expect(item.row.name).toBe('X');
    expect(item.row.qty).toBe(1);
  });

  // 场景 2：A patches name at t=100, B patches qty at t=200 — both fields win
  it('场景2: two independent patches — both fields should be present', async () => {
    const id = '11111111-0001-4000-8000-000000000002';
    await app.inject({
      method: 'POST', url: '/sync/push',
      payload: { deviceId: 'devA', ops: [{ kind: 'upsert', table: 'item', row: itemBase(id, { name: 'orig', qty: 1, updated_at: 50 }) }] },
    });
    // devA patches name at t=100
    await app.inject({
      method: 'POST', url: '/sync/push',
      payload: { deviceId: 'devA', ops: [{ kind: 'patch', table: 'item', id, fields: { name: 'A' }, updated_at: 100, updated_by: 'devA', base_version: 0 }] },
    });
    // devB patches qty at t=200
    await app.inject({
      method: 'POST', url: '/sync/push',
      payload: { deviceId: 'devB', ops: [{ kind: 'patch', table: 'item', id, fields: { qty: 5 }, updated_at: 200, updated_by: 'devB', base_version: 0 }] },
    });
    const pull = await app.inject({ url: '/sync/pull?since=0' });
    const item = pull.json().changes.find((c: any) => c.table === 'item' && c.row.id === id);
    expect(item.row.name).toBe('A');
    expect(item.row.qty).toBe(5);
  });

  // 场景 3：LWW conflict — A patches name at t=200, B patches name at t=100 → A wins, conflict logged
  it('场景3: LWW conflict on same field — higher timestamp wins, conflict logged', async () => {
    const id = '11111111-0001-4000-8000-000000000003';
    await app.inject({
      method: 'POST', url: '/sync/push',
      payload: { deviceId: 'devA', ops: [{ kind: 'upsert', table: 'item', row: itemBase(id, { name: 'orig', updated_at: 50 }) }] },
    });
    // devA patches name at t=200 (higher timestamp)
    await app.inject({
      method: 'POST', url: '/sync/push',
      payload: { deviceId: 'devA', ops: [{ kind: 'patch', table: 'item', id, fields: { name: 'A' }, updated_at: 200, updated_by: 'devA', base_version: 0 }] },
    });
    // devB patches name at t=100 (lower timestamp, arrives later)
    const push = await app.inject({
      method: 'POST', url: '/sync/push',
      payload: { deviceId: 'devB', ops: [{ kind: 'patch', table: 'item', id, fields: { name: 'B' }, updated_at: 100, updated_by: 'devB', base_version: 0 }] },
    });
    // devB's patch should conflict
    expect(push.json().conflicts.length).toBeGreaterThanOrEqual(1);
    expect(push.json().conflicts[0].field).toBe('name');
    // name should remain A (higher timestamp wins)
    const pull = await app.inject({ url: '/sync/pull?since=0' });
    const item = pull.json().changes.find((c: any) => c.table === 'item' && c.row.id === id);
    expect(item.row.name).toBe('A');
  });

  // 场景 4：patch on unknown id — ignored, no error
  it('场景4: patch on unknown id — ignored, not an error', async () => {
    const id = '11111111-0001-4000-8000-000000000099';
    const push = await app.inject({
      method: 'POST', url: '/sync/push',
      payload: { deviceId: 'devA', ops: [{ kind: 'patch', table: 'item', id, fields: { name: 'X' }, updated_at: 1000, updated_by: 'devA', base_version: 0 }] },
    });
    expect(push.statusCode).toBe(200);
    // Unknown id is not in accepted (we skip it)
    expect(push.json().accepted).not.toContain(id);
    expect(push.json().conflicts).toHaveLength(0);
  });
});
