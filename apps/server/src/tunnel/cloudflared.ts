/**
 * Cloudflare Tunnel integration — system PATH binary only (no npm package).
 *
 * Prerequisites: install cloudflared into system PATH before starting.
 *   macOS:   brew install cloudflared
 *   Linux:   https://pkg.cloudflare.com/index.html
 *   Windows: winget install --id Cloudflare.cloudflared
 *
 * Modes:
 *   KEEPSAKE_TUNNEL=quick   — ephemeral trycloudflare.com domain
 *   KEEPSAKE_TUNNEL=named   — persistent subdomain via KEEPSAKE_TUNNEL_TOKEN
 */
import { spawn, type ChildProcess } from 'node:child_process';

let activeProc: ChildProcess | null = null;

// ── Availability check ────────────────────────────────────────────────────

function checkCloudflaredAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('cloudflared', ['--version'], { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('exit', (code) => resolve(code === 0));
  });
}

function printInstallGuide(): void {
  console.error(`
❌ cloudflared not found in PATH.
To enable Cloudflare Tunnel:
  macOS:   brew install cloudflared
  Linux:   https://pkg.cloudflare.com/index.html
  Windows: winget install --id Cloudflare.cloudflared
Then re-run with KEEPSAKE_TUNNEL=quick.
Continuing in LAN-only mode...
`);
}

// ── Quick tunnel (trycloudflare) ──────────────────────────────────────────

function startQuickTunnel(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      activeProc?.kill('SIGTERM');
      reject(new Error('[CF Tunnel] Timed out waiting for quick tunnel URL (45s)'));
    }, 45_000);

    const proc = spawn(
      'cloudflared',
      ['tunnel', '--url', `http://localhost:${port}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    activeProc = proc;

    const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString();
      const match = text.match(urlRegex);
      if (match) {
        clearTimeout(timeout);
        console.log(`[CF Tunnel] Quick tunnel URL: ${match[0]}`);
        resolve(match[0]);
      } else {
        // Always forward cloudflared stderr so errors are visible
        process.stderr.write(`[cloudflared] ${text}`);
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);  // cloudflared outputs URL to stderr

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`[CF Tunnel] cloudflared spawn error: ${err.message}`));
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0 && code !== null) {
        reject(new Error(`[CF Tunnel] cloudflared exited with code ${code}`));
      }
    });
  });
}

// ── Named tunnel (persistent subdomain) ───────────────────────────────────

function startNamedTunnel(token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      activeProc?.kill('SIGTERM');
      reject(new Error('[CF Tunnel] Named tunnel timed out (30s)'));
    }, 30_000);

    const proc = spawn(
      'cloudflared',
      ['tunnel', 'run', '--token', token],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    activeProc = proc;

    const urlRegex = /https:\/\/[\w-]+\.trycloudflare\.com|https:\/\/[\w.-]+\.cfargotunnel\.com/;

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString();
      const sanitized = text.replace(token, '<REDACTED>');
      const match = text.match(urlRegex);
      if (match) {
        clearTimeout(timeout);
        console.log(`[CF Tunnel] Named tunnel URL: ${match[0]}`);
        resolve(match[0]);
      } else {
        // Always forward cloudflared output so errors are visible (token redacted)
        process.stderr.write(`[cloudflared] ${sanitized}`);
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`[CF Tunnel] cloudflared spawn error: ${err.message}`));
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0 && code !== null) {
        reject(new Error(`[CF Tunnel] cloudflared exited with code ${code}`));
      }
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────

export async function startTunnel(port: number): Promise<string | null> {
  const available = await checkCloudflaredAvailable();
  if (!available) {
    printInstallGuide();
    return null;  // caller treats null as LAN-only mode
  }

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
      return await startNamedTunnel(token);
    } catch (err) {
      console.warn(
        `[CF Tunnel] Named tunnel failed: ${err instanceof Error ? err.message : err}. ` +
        'Falling back to quick (trycloudflare) mode.',
      );
      return startQuickTunnel(port);
    }
  }

  // Default: quick mode
  console.log('[CF Tunnel] Starting quick tunnel…');
  try {
    return await startQuickTunnel(port);
  } catch (err) {
    console.warn(
      `[CF Tunnel] Quick tunnel failed: ${err instanceof Error ? err.message : err}. ` +
      'Continuing in LAN-only mode...',
    );
    return null;
  }
}

export function stopTunnel(): void {
  if (activeProc) {
    try { activeProc.kill('SIGTERM'); } catch { /* ignore */ }
    activeProc = null;
  }
}

// Cleanup on process exit
process.on('exit', stopTunnel);
process.on('SIGINT', () => { stopTunnel(); process.exit(0); });
process.on('SIGTERM', () => { stopTunnel(); process.exit(0); });
