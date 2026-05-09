/**
 * Auth routes for spike/auth-cf-tunnel
 *
 * POST /auth/pair          { root_secret, device_name? }  → { device_token, device_id }
 * POST /auth/invite        (authed) → { invite_token, expires_in }
 * POST /auth/join          { invite_token, device_name? } → { device_token, device_id }
 * GET  /auth/devices       (authed) → device[]
 * DELETE /auth/devices/:id (authed) → { ok }
 * GET  /auth/qrcode        → SVG image (pair QR)
 */
import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ensureRootSecret, hashToken } from '../auth/secret.js';
import { issueDeviceToken, issueInviteToken, verifyToken } from '../auth/jwt.js';
import { generateQrSvg, buildPairPayload } from '../auth/qrcode.js';
import { getLocalIp } from '../auth/localip.js';
import { authState } from '../auth/state.js';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const db = fastify.db;

  // Initialize secrets on first registration
  authState.rootSecret = ensureRootSecret(db);
  authState.jwtSecret = `jwt:${authState.rootSecret}`;

  // ── POST /auth/pair ──────────────────────────────────────────────────────
  fastify.post<{ Body: { root_secret: string; device_name?: string } }>('/auth/pair', async (req, reply) => {
    const { root_secret, device_name = 'Unknown Device' } = req.body ?? {};
    if (!root_secret || root_secret !== authState.rootSecret) {
      return reply.code(401).send({ error: 'invalid root_secret' });
    }
    const deviceId = randomUUID();
    const token = issueDeviceToken(deviceId, authState.jwtSecret);
    db.prepare('INSERT INTO devices (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)').run(
      deviceId, device_name, hashToken(token), Date.now()
    );
    return { device_token: token, device_id: deviceId };
  });

  // ── POST /auth/invite ────────────────────────────────────────────────────
  fastify.post('/auth/invite', async (_req, _reply) => {
    const token = issueInviteToken(authState.jwtSecret);
    return { invite_token: token, expires_in: 300 };
  });

  // ── POST /auth/join ──────────────────────────────────────────────────────
  fastify.post<{ Body: { invite_token: string; device_name?: string } }>('/auth/join', async (req, reply) => {
    const { invite_token, device_name = 'Unknown Device' } = req.body ?? {};
    if (!invite_token) return reply.code(400).send({ error: 'invite_token required' });
    const payload = verifyToken(invite_token, authState.jwtSecret);
    if (!payload || payload.type !== 'invite') {
      return reply.code(401).send({ error: 'invalid or expired invite_token' });
    }
    const deviceId = randomUUID();
    const token = issueDeviceToken(deviceId, authState.jwtSecret);
    db.prepare('INSERT INTO devices (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)').run(
      deviceId, device_name, hashToken(token), Date.now()
    );
    return { device_token: token, device_id: deviceId };
  });

  // ── GET /auth/devices ────────────────────────────────────────────────────
  fastify.get('/auth/devices', async () => {
    return db.prepare('SELECT id, name, created_at, last_seen FROM devices ORDER BY created_at DESC').all();
  });

  // ── DELETE /auth/devices/:id ─────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/auth/devices/:id', async (req, _reply) => {
    db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  // ── GET /auth/qrcode ─────────────────────────────────────────────────────
  fastify.get('/auth/qrcode', async (_req, reply) => {
    const port = Number(process.env.PORT ?? 8443);
    const host = getLocalIp();
    const payload = buildPairPayload({
      host,
      port,
      rootSecret: authState.rootSecret,
      tunnelUrl: fastify.tunnelUrl,
    });
    const svg = await generateQrSvg(payload);
    reply.header('Content-Type', 'image/svg+xml');
    return reply.send(svg);
  });
};
