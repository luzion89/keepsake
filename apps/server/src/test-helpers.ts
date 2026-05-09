/**
 * Test helper: pair a device and return a Bearer token for use in inject() headers.
 */
import type { FastifyInstance } from 'fastify';
import { authState } from './auth/state.js';

export async function getTestAuthHeader(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/pair',
    payload: { root_secret: authState.rootSecret, device_name: 'test-device' },
  });
  if (res.statusCode !== 200) throw new Error(`pair failed: ${res.body}`);
  const { device_token } = res.json();
  return `Bearer ${device_token}`;
}
