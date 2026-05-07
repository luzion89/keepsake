import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db/open.js';
import { syncRoutes } from './routes/sync.js';
import { blobRoutes } from './routes/blobs.js';
import { aiRoutes } from './routes/ai.js';
import { healthRoutes } from './routes/health.js';
import { logsRoutes } from './routes/logs.js';
import type Database from 'better-sqlite3';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database.Database;
  }
}

export async function buildServer() {
  const fastify = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
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
  const __dirname = dirname(fileURLToPath(import.meta.url));
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
      app.log.info(`Keepsake server on http://0.0.0.0:${port}`);
    });
  });
}
