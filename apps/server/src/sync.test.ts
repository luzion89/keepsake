import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from './index.js';
import { rmSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { getTestAuthHeader } from './test-helpers.js';

const TEST_DB = './data/test-sync.sqlite';

describe('sync routes', () => {
  let app: FastifyInstance;
  let auth: string;

  beforeAll(async () => {
    process.env.KEEPSAKE_DB = TEST_DB;
    try { rmSync(TEST_DB, { force: true }); } catch {}
    app = await buildServer();
    await app.ready();
    auth = await getTestAuthHeader(app);
  });

  afterAll(async () => {
    await app.close();
    try { rmSync(TEST_DB, { force: true }); } catch {}
  });

  it('pull empty', async () => {
    const res = await app.inject({ url: '/sync/pull?since=0', headers: { authorization: auth } });
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
      headers: { authorization: auth },
      payload: { deviceId: 'devA', ops: [{ kind: 'upsert', table: 'room', row: room }] },
    });
    expect(push.statusCode).toBe(200);
    expect(push.json().accepted).toContain(room.id);

    const pull = await app.inject({ url: '/sync/pull?since=0', headers: { authorization: auth } });
    const body = pull.json();
    expect(body.changes.length).toBe(1);
    expect(body.changes[0].row.name).toBe('Kitchen');
  });

  it('LWW conflict logged', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const r1 = { id, name: 'Old', photo_ids: [], updated_at: 100, updated_by: 'A', deleted: false, version: 0 };
    const r2 = { id, name: 'New', photo_ids: [], updated_at: 200, updated_by: 'B', deleted: false, version: 0 };
    await app.inject({ method:'POST', url:'/sync/push', headers:{ authorization: auth }, payload:{ deviceId:'A', ops:[{kind:'upsert',table:'room',row:r1}] } });
    const push = await app.inject({ method:'POST', url:'/sync/push', headers:{ authorization: auth }, payload:{ deviceId:'B', ops:[{kind:'upsert',table:'room',row:r2}] } });
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
    await app.inject({ method:'POST', url:'/sync/push', headers:{ authorization: auth }, payload:{ deviceId:'A', ops:[{kind:'upsert',table:'item',row:item}] } });
    await app.inject({ method:'POST', url:'/sync/push', headers:{ authorization: auth }, payload:{ deviceId:'A', ops:[{kind:'qty_delta', itemId:id, delta:2, updated_at:1100}] } });
    await app.inject({ method:'POST', url:'/sync/push', headers:{ authorization: auth }, payload:{ deviceId:'B', ops:[{kind:'qty_delta', itemId:id, delta:-1, updated_at:1200}] } });
    const pull = await app.inject({ url: '/sync/pull?since=0', headers:{ authorization: auth } });
    const items = pull.json().changes.filter((c: any) => c.table === 'item' && c.row.id === id);
    expect(items.at(-1).row.qty).toBe(6);
  });
});
