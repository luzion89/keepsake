import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import { resolve, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db/open.js';
import { syncRoutes } from './routes/sync.js';
import { blobRoutes } from './routes/blobs.js';
import { aiRoutes } from './routes/ai.js';
import { healthRoutes } from './routes/health.js';
import { logsRoutes } from './routes/logs.js';
import { authRoutes } from './routes/auth.js';
import { registerAuthMiddleware } from './auth/middleware.js';
import { startTunnel } from './tunnel/cloudflared.js';
import { getLocalIp } from './auth/localip.js';
import { buildPairPayload } from './auth/qrcode.js';
import { authState } from './auth/state.js';
import type Database from 'better-sqlite3';
import qrTerminal from 'qrcode-terminal';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database.Database;
    tunnelUrl?: string | null;
  }
}

function buildHttpsOptions(serverRoot: string): { key: Buffer; cert: Buffer } | undefined {
  if (!process.env.KEEPSAKE_TLS) return undefined;

  const certPath = process.env.KEEPSAKE_TLS_CERT ?? resolve(serverRoot, '../certs/dev-cert.pem');
  const keyPath  = process.env.KEEPSAKE_TLS_KEY  ?? resolve(serverRoot, '../certs/dev-key.pem');

  if (!existsSync(certPath) || !existsSync(keyPath)) {
    console.error(
      `[KEEPSAKE_TLS] ERROR: Certificate files not found.\n` +
      `  cert: ${certPath}\n` +
      `  key:  ${keyPath}\n` +
      `Run the following to generate them:\n` +
      `  cd apps/server/certs && mkcert -cert-file dev-cert.pem -key-file dev-key.pem localhost 127.0.0.1 <your-LAN-IP> ::1`,
    );
    process.exit(1);
  }

  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

export async function buildServer() {
  const __dirnameForTls = dirname(fileURLToPath(import.meta.url));
  const httpsOptions = buildHttpsOptions(__dirnameForTls);

  const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    ...(httpsOptions ? { https: httpsOptions } : {}),
  });
  const { db } = openDb();
  fastify.decorate('db', db);
  fastify.decorate('tunnelUrl', null as string | null);

  await fastify.register(cors, { origin: true, credentials: true });
  await fastify.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  // Auth routes first — they initialize authState.rootSecret / jwtSecret
  await fastify.register(authRoutes);

  // Global auth middleware — must be registered AFTER authRoutes so authState is populated
  registerAuthMiddleware(fastify, () => authState);

  await fastify.register(healthRoutes);
  await fastify.register(syncRoutes);
  await fastify.register(blobRoutes);
  await fastify.register(aiRoutes);
  await fastify.register(logsRoutes);

  // Serve PWA static build (if present after `pnpm build`)
  const pwaDist = resolve(__dirnameForTls, '../../pwa/dist');
  if (existsSync(pwaDist)) {
    await fastify.register(staticPlugin, { root: pwaDist, prefix: '/', wildcard: false });
    fastify.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && req.headers.accept?.includes('text/html')) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'not found' });
    });
  }

  return fastify;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8443);
  buildServer().then(async (app) => {
    // 1. Listen first — cloudflared quick tunnel probes the origin on startup,
    //    so the server must be accepting connections before cloudflared launches.
    await app.listen({ host: '0.0.0.0', port });
    const proto = process.env.KEEPSAKE_TLS ? 'https' : 'http';
    const localIp = getLocalIp();
    app.log.info(`Keepsake server on ${proto}://0.0.0.0:${port}`);

    // 2. Start CF Tunnel after the server is ready.
    //    Supports: KEEPSAKE_TUNNEL=quick | named | 1 (legacy)
    const tunnelMode = process.env.KEEPSAKE_TUNNEL ?? '';
    if (['quick', 'named', '1'].includes(tunnelMode)) {
      try {
        const tunnelUrl = await startTunnel(port);
        if (tunnelUrl) {
          app.tunnelUrl = tunnelUrl;
          console.log(`\n[CF Tunnel] ✅ Public URL: ${tunnelUrl}\n`);
        }
      } catch (e) {
        // Tunnel failure is non-fatal — server continues in LAN-only mode
        console.error('[CF Tunnel] ❌ Failed to start tunnel — continuing in LAN-only mode:', (e as Error).message);
      }
    }

    // 3. Print Pair Info block after tunnel result is known
    const payload = buildPairPayload({
      host: localIp,
      port,
      rootSecret: authState.rootSecret,
      tunnelUrl: app.tunnelUrl ?? undefined,
    });

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║                  === Pair Info ===                  ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log(`  🏠 Local:   ${proto}://${localIp}:${port}`);
    console.log(`  🔐 QR SVG:  ${proto}://${localIp}:${port}/auth/qrcode`);
    if (app.tunnelUrl) {
      console.log(`  🌐 Public:  ${app.tunnelUrl}`);
      console.log(`  🌐 QR SVG:  ${app.tunnelUrl}/auth/qrcode`);
    }
    console.log('\n  📱 Scan to pair (point camera at QR below):');
    console.log('');
    // Print ASCII QR to stdout
    qrTerminal.generate(payload, { small: true }, (qr: string) => {
      qr.split('\n').forEach((line: string) => console.log('  ' + line));
    });
    console.log('\n══════════════════════════════════════════════════════\n');
  });
}
