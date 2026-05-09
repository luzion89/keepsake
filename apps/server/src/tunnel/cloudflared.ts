/**
 * Spike B: Cloudflare Tunnel integration.
 *
 * Uses the `cloudflared` npm package which auto-downloads the cloudflared binary.
 * Starts a quick tunnel (trycloudflare.com) and captures the assigned URL.
 *
 * Limitations (documented):
 * - Each restart gets a NEW trycloudflare.com subdomain (ephemeral).
 * - Requires outbound internet access.
 * - CF sees traffic plaintext at their edge (app-layer E2E left for future).
 */
import { createRequire } from 'node:module';

// Use createRequire to import CJS cloudflared package from ESM context
const require = createRequire(import.meta.url);
const { Tunnel } = require('cloudflared/lib/tunnel.js') as {
  Tunnel: {
    quick(url: string, options?: Record<string, unknown>): {
      stop: () => void;
      on(event: 'url', cb: (url: string) => void): void;
      on(event: 'error', cb: (err: Error) => void): void;
    }
  }
};

let activeTunnel: { stop: () => void } | null = null;

export async function startTunnel(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('[CF Tunnel] Timed out waiting for tunnel URL (45s)'));
    }, 45_000);

    try {
      const t = Tunnel.quick(`http://localhost:${port}`);
      activeTunnel = t;

      t.on('url', (url: string) => {
        clearTimeout(timeout);
        console.log(`[CF Tunnel] Got URL: ${url}`);
        resolve(url);
      });

      (t as any).on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

export function stopTunnel() {
  if (activeTunnel) {
    try { activeTunnel.stop(); } catch { /* ignore */ }
    activeTunnel = null;
  }
}

// Cleanup on process exit
process.on('exit', stopTunnel);
process.on('SIGINT', () => { stopTunnel(); process.exit(0); });
process.on('SIGTERM', () => { stopTunnel(); process.exit(0); });
