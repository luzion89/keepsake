import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from './index.js';
import { rmSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';

const TEST_DB = './data/test-health.sqlite';

describe('health route enrichment', () => {
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

  it('GET /health returns ok, time, version, db and backup fields', async () => {
    const res = await app.inject({ url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.time).toBe('number');
    expect(typeof body.version).toBe('string');
    expect(typeof body.db).toBe('object');
    expect(body.db.ok).toBe(true);
    expect(typeof body.backup).toBe('object');
    expect(typeof body.backup.count).toBe('number');
  });
});
