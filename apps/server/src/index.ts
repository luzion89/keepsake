import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import { resolve, dirname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db/open.js';
import { syncRoutes } from './routes/sync.js';
import { blobRoutes } from './routes/blobs.js';
import { aiRoutes } from './routes/ai.js';
import { healthRoutes } from './routes/health.js';
import { logsRoutes } from './routes/logs.js';
import type Database from 'better-sqlite3';
import { startBackupScheduler } from './backup.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database.Database;
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


function getLanIp(): string {
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'N/A';
}

function printBanner(proto: string, port: number): void {
  const lanIp = getLanIp();
  const lanUrl = lanIp === 'N/A' ? 'N/A' : `${proto}://${lanIp}:${port}`;
  const localUrl = `${proto}://localhost:${port}`;
  const w = 50;
  const pad = (s: string) => ` ${s}${' '.repeat(Math.max(0, w - 2 - s.length))}`;
  const line = '═'.repeat(w - 2);
  console.log(`╔${line}╗`);
  console.log(`║${pad('🗝  Keepsake Server 已启动')}║`);
  console.log(`╠${line}╣`);
  console.log(`║${pad(`LAN      ${lanUrl}`)}║`);
  console.log(`║${pad(`本机     ${localUrl}`)}║`);
  console.log(`╠${line}╣`);
  console.log(`║${pad('手机/平板请使用 LAN URL')}║`);
  console.log(`║${pad('浏览器红屏点"高级 → 继续"即可访问')}║`);
  console.log(`╚${line}╝`);
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

  await fastify.register(cors, { origin: true, credentials: true });
  await fastify.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  await fastify.register(healthRoutes);
  await fastify.register(syncRoutes);
  await fastify.register(blobRoutes);
  await fastify.register(aiRoutes);
  await fastify.register(logsRoutes);

  // Serve PWA static build (if present after `pnpm build`)
  const __dirname = __dirnameForTls;
  const pwaDist = resolve(__dirname, '../../pwa/dist');
  if (existsSync(pwaDist)) {
    await fastify.register(staticPlugin, { root: pwaDist, prefix: '/', wildcard: false });

    // Block localhost access to SPA HTML entry points (issue #221).
    // API paths (/sync /blobs /ai /health /logs) are not blocked so that
    // the Vite dev proxy (which points localhost:8443) keeps working.
    // Set KEEPSAKE_ALLOW_LOCALHOST=1 to bypass (dev back-door).
    const LOCALHOST_BLOCK_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>请使用局域网 IP 访问</title>
<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:10vh auto;padding:1rem;line-height:1.7}</style>
</head><body>
<h1>请使用局域网 IP 访问</h1>
<p>本应用已不再支持 localhost 访问入口。</p>
<p>请使用启动日志中显示的 LAN IP（如 <code>https://192.168.x.x:8443</code>）访问。</p>
<p>如果你之前在 localhost 上装过 PWA，请到浏览器 DevTools → Application → Storage 清除站点数据后，改用 LAN IP 重新打开。</p>
</body></html>`;

    const API_PREFIXES = ['/sync', '/blobs', '/ai', '/health', '/logs', '/settings'];

    fastify.addHook('onRequest', (req, reply, done) => {
      if (process.env.KEEPSAKE_ALLOW_LOCALHOST === '1') return done();
      if (req.method !== 'GET') return done();

      const host = (req.headers.host ?? '').split(':')[0];
      const isLocalhost = host === 'localhost' || host === '127.0.0.1';
      if (!isLocalhost) return done();

      const path = (req.url ?? '/').split('?')[0];
      const isApiPath = API_PREFIXES.some(p => path!.startsWith(p));
      if (isApiPath) return done();

      // SPA HTML entry: either '/' or any path that would serve index.html
      const accept = req.headers.accept ?? '';
      if (accept.includes('text/html') || path === '/' || !path!.includes('.')) {
        reply.code(410).header('Content-Type', 'text/html; charset=utf-8').send(LOCALHOST_BLOCK_HTML);
        return;
      }
      done();
    });

    fastify.setNotFoundHandler((req, reply) => {
      // SPA fallback
      if (req.method === 'GET' && req.headers.accept?.includes('text/html')) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'not found' });
    });
  }

  return fastify;
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1]!)) {
  const port = Number(process.env.PORT ?? 8443);
  buildServer().then((app) => {
    app.listen({ host: '0.0.0.0', port }).then(() => {
      const proto = process.env.KEEPSAKE_TLS ? 'https' : 'http';
      app.log.info(`Keepsake server on ${proto}://0.0.0.0:${port}`);
      printBanner(proto, port);

      // 启动自动备份调度
      const dbPath = process.env.KEEPSAKE_DB ?? './data/keepsake.sqlite';
      const backupDir = resolve(dbPath, '../backups');
      const intervalDays = Number(process.env.KEEPSAKE_BACKUP_INTERVAL_DAYS ?? 7);
      const keep = Number(process.env.KEEPSAKE_BACKUP_KEEP ?? 4);
      const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
      startBackupScheduler(app.db, { dbPath, backupDir, intervalMs, keep });
    });
  });
}
