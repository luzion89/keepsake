import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from './index.js';
import { rmSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';

const TEST_DB = './data/test-sync.sqlite';

describe('sync routes', () => {
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

  it('pull empty', async () => {
    const res = await app.inject({ url: '/sync/pull?since=0' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.changes).toEqual([]);
    expect(typeof body.serverTime).toBe('number');
  });

  it('push then pull returns the row', async () => {
    const room = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Kitchen',
      icon: undefined,
      photo_ids: [],
      note: undefined,
      updated_at: 1000,
      updated_by: 'devA',
      deleted: false,
      version: 0,
    };
    const push = await app.inject({
      method: 'POST',
      url: '/sync/push',
      payload: { deviceId: 'devA', ops: [{ kind: 'upsert', table: 'room', row: room }] },
    });
    expect(push.statusCode).toBe(200);
    expect(push.json().accepted).toContain(room.id);
    // response includes rejected array (empty)
    expect(Array.isArray(push.json().rejected)).toBe(true);

    const pull = await app.inject({ url: '/sync/pull?since=0' });
    const body = pull.json();
    expect(body.changes.length).toBe(1);
    expect(body.changes[0].row.name).toBe('Kitchen');
  });

  it('LWW conflict logged', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const r1 = { id, name: 'Old', photo_ids: [], updated_at: 100, updated_by: 'A', deleted: false, version: 0 };
    const r2 = { id, name: 'New', photo_ids: [], updated_at: 200, updated_by: 'B', deleted: false, version: 0 };
    await app.inject({ method:'POST', url:'/sync/push', payload:{ deviceId:'A', ops:[{kind:'upsert',table:'room',row:r1}] } });
    const push = await app.inject({ method:'POST', url:'/sync/push', payload:{ deviceId:'B', ops:[{kind:'upsert',table:'room',row:r2}] } });
    expect(push.json().conflicts.length).toBe(1);
    expect(push.json().conflicts[0].field).toBe('name');
  });

  it('qty_delta accumulates', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const item = {
      id, area_id: '44444444-4444-4444-8444-444444444444',
      name: 'screws', qty: 5, tags: [], photo_ids: [], source: 'manual',
      updated_at: 1000, updated_by: 'A', deleted: false, version: 0,
    };
    await app.inject({ method:'POST', url:'/sync/push', payload:{ deviceId:'A', ops:[{kind:'upsert',table:'item',row:item}] } });
    await app.inject({ method:'POST', url:'/sync/push', payload:{ deviceId:'A', ops:[{kind:'qty_delta', itemId:id, delta:2, updated_at:1100}] } });
    await app.inject({ method:'POST', url:'/sync/push', payload:{ deviceId:'B', ops:[{kind:'qty_delta', itemId:id, delta:-1, updated_at:1200}] } });
    const pull = await app.inject({ url: '/sync/pull?since=0' });
    const items = pull.json().changes.filter((c: any) => c.table === 'item' && c.row.id === id);
    expect(items.at(-1).row.qty).toBe(6);
  });

  it('qty_delta on unknown item returns rejected entry', async () => {
    const missingId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const push = await app.inject({
      method: 'POST', url: '/sync/push',
      payload: { deviceId: 'devA', ops: [{ kind: 'qty_delta', itemId: missingId, delta: 1, updated_at: 999 }] },
    });
    expect(push.statusCode).toBe(200);
    const body = push.json();
    expect(body.accepted).not.toContain(missingId);
    expect(body.rejected.length).toBe(1);
    expect(body.rejected[0].reason).toBe('NOT_FOUND');
  });

  it('invalid push body returns VALIDATION_ERROR', async () => {
    const push = await app.inject({
      method: 'POST', url: '/sync/push',
      payload: { bad: 'payload' },
    });
    expect(push.statusCode).toBe(400);
    expect(push.json().error).toBe('VALIDATION_ERROR');
  });

  it('pull with since boundary: only returns rows updated after since', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    const item = {
      id, area_id: '66666666-6666-4666-8666-666666666666',
      name: 'boundary-item', qty: 1, tags: [], photo_ids: [], source: 'manual',
      updated_at: 500, updated_by: 'A', deleted: false, version: 0,
    };
    await app.inject({ method:'POST', url:'/sync/push', payload:{ deviceId:'A', ops:[{kind:'upsert',table:'item',row:item}] } });
    // Pull with since >= updated_at should return empty for that item
    const pull = await app.inject({ url: `/sync/pull?since=500` });
    const found = pull.json().changes.find((c: any) => c.row?.id === id);
    expect(found).toBeUndefined();
    // Pull with since < updated_at should return the item
    const pull2 = await app.inject({ url: `/sync/pull?since=499` });
    const found2 = pull2.json().changes.find((c: any) => c.row?.id === id);
    expect(found2).toBeDefined();
  });
});
