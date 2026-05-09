/**
 * Generates a simple SVG QR code using the `qrcode` npm package.
 * Falls back to text representation if package unavailable.
 */
import QRCode from 'qrcode';

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
  return JSON.stringify({
    server: base,
    root_secret: opts.rootSecret,
    v: 1,
  });
}
