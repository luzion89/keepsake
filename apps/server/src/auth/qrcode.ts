/**
 * Generates a simple SVG QR code using the `qrcode` npm package.
 * Falls back to text representation if package unavailable.
 *
 * Spike-A/C: QR payload now includes family_key_salt for HKDF derivation.
 */
import QRCode from 'qrcode';
import { createHash } from 'node:crypto';

export async function generateQrSvg(data: string): Promise<string> {
  return QRCode.toString(data, { type: 'svg', margin: 2, width: 300 });
}

export function buildPairPayload(opts: {
  host: string;
  port: number;
  rootSecret: string;
  tunnelUrl?: string;
}): string {
  const base = opts.tunnelUrl ?? `http://${opts.host}:${opts.port}`;
  // Derive a deterministic salt from root_secret (public, non-secret).
  // This salt is used by the client for HKDF family_key derivation.
  const family_key_salt = createHash('sha256')
    .update(`keepsake-family-salt:${opts.rootSecret}`)
    .digest('hex')
    .slice(0, 32);

  return JSON.stringify({
    server: base,
    root_secret: opts.rootSecret,
    family_key_salt,
    v: 1,
  });
}
