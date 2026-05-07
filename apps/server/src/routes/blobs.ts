import type { FastifyPluginAsync } from 'fastify';
import { mkdirSync, createWriteStream, existsSync, createReadStream, readdirSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';

const UPLOAD_DIR = process.env.KEEPSAKE_UPLOADS ?? './uploads';
const BLOB_DIR = resolve(process.env.KEEPSAKE_BLOBS ?? './data/blobs');

export const blobRoutes: FastifyPluginAsync = async (fastify) => {
  mkdirSync(resolve(UPLOAD_DIR), { recursive: true });
  mkdirSync(BLOB_DIR, { recursive: true });

  // Legacy multipart upload (photo / general)
  fastify.post('/blobs', async (req, reply) => {
    if (!req.isMultipart()) { reply.code(400); return { error: 'expect multipart' }; }
    const file = await req.file();
    if (!file) { reply.code(400); return { error: 'no file' }; }
    const id = crypto.randomUUID();
    const ext = (file.filename ?? '').split('.').pop() || 'bin';
    const outPath = resolve(UPLOAD_DIR, `${id}.${ext}`);
    await pipeline(file.file, createWriteStream(outPath));
    return { id, url: `/blobs/${id}.${ext}` };
  });

  // Cross-device blob upload by id (PUT /blobs/:id)
  fastify.put<{ Params: { id: string } }>('/blobs/:id', async (req, reply) => {
    const { id } = req.params;
    if (!/^[\w-]{1,128}$/.test(id)) { reply.code(400); return { error: 'invalid id' }; }
    if (!req.isMultipart()) { reply.code(400); return { error: 'expect multipart' }; }
    const file = await req.file();
    if (!file) { reply.code(400); return { error: 'no file' }; }
    const blobPath = join(BLOB_DIR, id);
    await pipeline(file.file, createWriteStream(blobPath));
    const now = Date.now();
    fastify.db.prepare(
      `INSERT INTO blob_meta (id, path, uploaded_at) VALUES (?,?,?)
       ON CONFLICT(id) DO UPDATE SET path=excluded.path, uploaded_at=excluded.uploaded_at`
    ).run(id, blobPath, now);
    return { id };
  });

  // Download blob by id
  fastify.get<{ Params: { id: string } }>('/blobs/id/:id', async (req, reply) => {
    const { id } = req.params;
    if (!/^[\w-]{1,128}$/.test(id)) { reply.code(400); return; }
    const row = fastify.db.prepare('SELECT path FROM blob_meta WHERE id = ?').get(id) as { path: string } | undefined;
    if (!row || !existsSync(row.path)) { reply.code(404); return; }
    reply.header('Cache-Control', 'public, max-age=2592000');
    return reply.send(createReadStream(row.path));
  });

  // List blobs since timestamp (for pull)
  fastify.get<{ Querystring: { since?: string } }>('/blobs/list', async (req) => {
    const since = Number(req.query.since ?? 0);
    const rows = fastify.db.prepare(
      'SELECT id FROM blob_meta WHERE uploaded_at > ? ORDER BY uploaded_at ASC LIMIT 1000'
    ).all(since) as { id: string }[];
    return { ids: rows.map(r => r.id) };
  });

  // Legacy named-file download (keep existing URL scheme)
  fastify.get<{ Params: { name: string } }>('/blobs/:name', async (req, reply) => {
    const p = resolve(UPLOAD_DIR, req.params.name);
    if (!p.startsWith(resolve(UPLOAD_DIR))) { reply.code(403); return; }
    if (!existsSync(p)) { reply.code(404); return; }
    reply.header('Cache-Control', 'public, max-age=2592000');
    return reply.send(createReadStream(p));
  });
};
