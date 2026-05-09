/**
 * Auth routes for spike/auth-cf-tunnel
 *
 * POST /auth/pair          { root_secret, device_name? }  → { device_token, device_id, family_id }
 * POST /auth/invite        (authed) → { invite_token, expires_in }
 * POST /auth/join          { invite_token, device_name? } → { device_token, device_id, family_id }
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
    // Server generates both family_id and device_id
    const familyId = randomUUID();
    const deviceId = randomUUID();
    const token = issueDeviceToken(deviceId, familyId, authState.jwtSecret);

    // Ensure family record exists
    db.prepare('INSERT OR IGNORE INTO families (id, created_at) VALUES (?, ?)').run(familyId, Date.now());
    db.prepare('INSERT INTO devices (id, family_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
      deviceId, familyId, device_name, hashToken(token), Date.now()
    );
    return { device_token: token, device_id: deviceId, family_id: familyId };
  });

  // ── POST /auth/invite ────────────────────────────────────────────────────
  // Requires auth; family_id is read from the requesting device's JWT.
  fastify.post('/auth/invite', async (req, reply) => {
    const familyId = (req as any).jwtPayload?.family_id as string | undefined;
    if (!familyId) return reply.code(401).send({ error: 'no family_id in token' });
    const token = issueInviteToken(familyId, authState.jwtSecret);
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
    const familyId = payload.family_id as string;
    if (!familyId) return reply.code(400).send({ error: 'invite_token missing family_id' });

    const deviceId = randomUUID();
    const token = issueDeviceToken(deviceId, familyId, authState.jwtSecret);
    db.prepare('INSERT INTO devices (id, family_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
      deviceId, familyId, device_name, hashToken(token), Date.now()
    );
    return { device_token: token, device_id: deviceId, family_id: familyId };
  });

  // ── GET /auth/devices ────────────────────────────────────────────────────
  fastify.get('/auth/devices', async (req) => {
    const familyId = (req as any).jwtPayload?.family_id as string | undefined;
    if (!familyId) return [];
    return db.prepare('SELECT id, name, created_at, last_seen FROM devices WHERE family_id = ? ORDER BY created_at DESC').all(familyId);
  });

  // ── DELETE /auth/devices/:id ─────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/auth/devices/:id', async (req, _reply) => {
    const familyId = (req as any).jwtPayload?.family_id as string | undefined;
    // Only allow deleting devices in same family
    db.prepare('DELETE FROM devices WHERE id = ? AND family_id = ?').run(req.params.id, familyId ?? '');
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
      tunnelUrl: fastify.tunnelUrl ?? undefined,
    });
    const svg = await generateQrSvg(payload);
    reply.header('Content-Type', 'image/svg+xml');
    return reply.send(svg);
  });
};
