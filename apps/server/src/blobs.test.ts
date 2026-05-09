import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from './index.js';
import { rmSync, mkdirSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { getTestAuthHeader } from './test-helpers.js';

const TEST_DB = './data/test-blobs.sqlite';
const TEST_BLOB_DIR = './data/test-blobs-store';

describe('blobs routes', () => {
  let app: FastifyInstance;
  let auth: string;

  beforeAll(async () => {
    process.env.KEEPSAKE_DB = TEST_DB;
    process.env.KEEPSAKE_BLOBS = TEST_BLOB_DIR;
    try { rmSync(TEST_DB, { force: true }); } catch {}
    try { rmSync(TEST_BLOB_DIR, { recursive: true, force: true }); } catch {}
    mkdirSync(TEST_BLOB_DIR, { recursive: true });
    app = await buildServer();
    await app.ready();
    auth = await getTestAuthHeader(app);
  });

  afterAll(async () => {
    await app.close();
    try { rmSync(TEST_DB, { force: true }); } catch {}
    try { rmSync(TEST_BLOB_DIR, { recursive: true, force: true }); } catch {}
    delete process.env.KEEPSAKE_BLOBS;
  });

  it('upload blob via PUT /blobs/:id', async () => {
    const blobContent = Buffer.from('hello blob content');
    const form = new FormData();
    form.append('file', new Blob([blobContent], { type: 'application/octet-stream' }), 'test-blob-id');

    const res = await app.inject({
      method: 'PUT',
      url: '/blobs/test-blob-id',
      headers: { authorization: auth },
      payload: form,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('test-blob-id');
  });

  it('download uploaded blob via GET /blobs/id/:id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/blobs/id/test-blob-id',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('hello blob content');
  });

  it('list blobs returns uploaded id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/blobs/list?since=0',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ids).toContain('test-blob-id');
  });

  it('list blobs with future since returns empty', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/blobs/list?since=${Date.now() + 10000}`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ids).toEqual([]);
  });
});
