import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from './index.js';
import { rmSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';

const TEST_DB = './data/test-ai.sqlite';

describe('/settings/ai 路由 Zod 校验', () => {
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

  it('合法 payload 应返回 200', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/ai',
      payload: { mode: 'on', apiKey: 'sk-or-test', model: 'google/gemini' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('非法 mode 应返回 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/ai',
      payload: { mode: 'invalid' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it('apiKey 超长（>200字符）应返回 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/ai',
      payload: { mode: 'on', apiKey: 'x'.repeat(201) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it('包含未知字段应返回 400（strict 模式）', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/ai',
      payload: { mode: 'off', unknownField: 'hacked' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });
});
