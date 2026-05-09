/**
 * Minimal JWT helpers using Node built-ins (no library needed for HS256).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString('base64url');
}

function sign(payload: object, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = b64url(createHmac('sha256', secret).update(data).digest());
  return `${data}.${sig}`;
}

function verify(token: string, secret: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [part0, part1, part2] = parts as [string, string, string];
    const data = `${part0}.${part1}`;
    const expectedSig = createHmac('sha256', secret).update(data).digest();
    const actualSig = Buffer.from(part2, 'base64url');
    if (expectedSig.length !== actualSig.length) return null;
    if (!timingSafeEqual(expectedSig, actualSig)) return null;
    const payload = JSON.parse(Buffer.from(part1, 'base64url').toString()) as Record<string, unknown>;
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function issueDeviceToken(deviceId: string, jwtSecret: string): string {
  return sign({ sub: deviceId, type: 'device', iat: Math.floor(Date.now() / 1000) }, jwtSecret);
}

export function issueInviteToken(jwtSecret: string): string {
  return sign({
    type: 'invite',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 5 * 60, // 5 minutes
  }, jwtSecret);
}

export function verifyToken(token: string, jwtSecret: string): Record<string, unknown> | null {
  return verify(token, jwtSecret);
}
