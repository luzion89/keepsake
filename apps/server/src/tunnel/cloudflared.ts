/**
 * Spike-B: Cloudflare Tunnel integration (two-mode).
 *
 * Modes (simplified from 3→2):
 *   KEEPSAKE_TUNNEL=quick   (default) — trycloudflare.com ephemeral domain
 *   KEEPSAKE_TUNNEL=named   — persistent subdomain via:
 *                             KEEPSAKE_TUNNEL_TOKEN=<token>
 *                             (obtain token from CF Zero Trust dashboard)
 *
 * Named tunnel fallback:
 *   If named mode fails to start within 30s, falls back to quick mode
 *   with a console warning. This allows users without a CF account to
 *   still use the app.
 *
 * Limitations (documented):
 * - Quick: Each restart gets a NEW trycloudflare.com subdomain (ephemeral).
 * - Both modes require outbound internet access.
 * - CF sees traffic plaintext at their edge (app-layer E2E via Spike-C).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Use createRequire to import CJS cloudflared package from ESM context
const require = createRequire(import.meta.url);

// cloudflared binary path from the npm package
let cloudflaredBin: string;
try {
  const pkg = require('cloudflared/package.json') as { main: string };
  // The package exposes the binary path via a known internal path
  cloudflaredBin = require.resolve('cloudflared/bin/cloudflared');
} catch {
  cloudflaredBin = 'cloudflared'; // fallback: assume it's in PATH
}

// Fallback to the quick tunnel helper from the cloudflared package
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

// ── Quick tunnel (trycloudflare) ──────────────────────────────────────────

async function startQuickTunnel(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('[CF Tunnel] Timed out waiting for quick tunnel URL (45s)'));
    }, 45_000);

    try {
      const t = Tunnel.quick(`http://localhost:${port}`);
      activeTunnel = t;

      t.on('url', (url: string) => {
        clearTimeout(timeout);
        console.log(`[CF Tunnel] Quick tunnel URL: ${url}`);
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

// ── Named tunnel (persistent subdomain) ───────────────────────────────────

/**
 * Start a named tunnel using `cloudflared tunnel run --token <token>`.
 * The tunnel URL is the hostname configured in the CF dashboard for this token.
 * We can't determine it programmatically — so we capture it from stderr output.
 */
async function startNamedTunnel(token: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('[CF Tunnel] Named tunnel timed out (30s) — no URL detected'));
    }, 30_000);

    // cloudflared tunnel run --token <token> --url http://localhost:<port>
    const proc = spawn(
      'cloudflared',
      ['tunnel', 'run', '--token', token, '--url', `http://localhost:${port}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    activeTunnel = {
      stop: () => { proc.kill('SIGTERM'); },
    };

    // Capture tunnel URL from cloudflared output
    const urlRegex = /https:\/\/[\w-]+\.trycloudflare\.com|https:\/\/[\w.-]+\.cfargotunnel\.com|https:\/\/[\w.-]+\.[a-z]{2,}/;

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      // Suppress token from logs for security
      const sanitized = text.replace(token, '<REDACTED>');
      process.stdout.write(`[CF Named Tunnel] ${sanitized}`);
      const match = text.match(urlRegex);
      if (match) {
        clearTimeout(timeout);
        console.log(`[CF Tunnel] Named tunnel URL: ${match[0]}`);
        resolve(match[0]);
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`[CF Tunnel] cloudflared spawn error: ${err.message}`));
    });

    proc.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`[CF Tunnel] cloudflared exited with code ${code}`));
      }
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────

export async function startTunnel(port: number): Promise<string> {
  const mode = process.env.KEEPSAKE_TUNNEL ?? 'quick';

  if (mode === 'named') {
    const token = process.env.KEEPSAKE_TUNNEL_TOKEN;
    if (!token) {
      console.warn(
        '[CF Tunnel] KEEPSAKE_TUNNEL=named but KEEPSAKE_TUNNEL_TOKEN is not set. ' +
        'Falling back to quick mode.',
      );
      return startQuickTunnel(port);
    }

    console.log('[CF Tunnel] Starting named tunnel…');
    try {
      return await startNamedTunnel(token, port);
    } catch (err) {
      console.warn(
        `[CF Tunnel] Named tunnel failed: ${err instanceof Error ? err.message : err}. ` +
        'Falling back to quick (trycloudflare) mode.',
      );
      return startQuickTunnel(port);
    }
  }

  // Default: quick mode
  return startQuickTunnel(port);
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
