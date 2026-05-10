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

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8443);
  buildServer().then((app) => {
    app.listen({ host: '0.0.0.0', port }).then(() => {
      const proto = process.env.KEEPSAKE_TLS ? 'https' : 'http';
      app.log.info(`Keepsake server on ${proto}://0.0.0.0:${port}`);

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
