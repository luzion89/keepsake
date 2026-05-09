/**
 * Global auth middleware for Fastify.
 * Skips: /auth/pair, /auth/join, /health, /auth/qrcode
 * All other routes require: Authorization: Bearer <device_token>
 */
import type { FastifyInstance } from 'fastify';
import { verifyToken } from './jwt.js';
import { hashToken } from './secret.js';
import type { authState as AuthState } from './state.js';

const PUBLIC_PATHS = new Set(['/auth/pair', '/auth/join', '/health', '/auth/qrcode']);

function isStaticAsset(path: string): boolean {
  return (
    path.startsWith('/assets/') ||
    path === '/' ||
    path.endsWith('.js') ||
    path.endsWith('.css') ||
    path.endsWith('.html') ||
    path.endsWith('.png') ||
    path.endsWith('.ico') ||
    path.endsWith('.json') ||
    path.endsWith('.webmanifest') ||
    path.endsWith('.svg') ||
    path.endsWith('.woff2') ||
    path.endsWith('.woff')
  );
}

export function registerAuthMiddleware(
  fastify: FastifyInstance,
  getState: () => typeof AuthState,
) {
  fastify.addHook('onRequest', async (req, reply) => {
    const path = (req.url ?? '').split('?')[0] ?? '';

    if (PUBLIC_PATHS.has(path)) return;
    if (isStaticAsset(path)) return;

    const authHeader = req.headers.authorization ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Authorization required' });
    }

    const token = authHeader.slice(7);
    const state = getState();
    if (!state.jwtSecret) {
      return reply.code(503).send({ error: 'Auth not initialized' });
    }
    const payload = verifyToken(token, state.jwtSecret);
    if (!payload || payload.type !== 'device') {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    // Update last_seen (best-effort)
    try {
      const tokenHash = hashToken(token);
      fastify.db.prepare('UPDATE devices SET last_seen = ? WHERE token_hash = ?').run(Date.now(), tokenHash);
    } catch { /* ignore */ }
  });
}
