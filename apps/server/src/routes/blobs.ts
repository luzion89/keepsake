import type { FastifyPluginAsync } from 'fastify';
import { mkdirSync, createWriteStream, existsSync, createReadStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const UPLOAD_DIR = process.env.KEEPSAKE_UPLOADS ?? './uploads';

export const blobRoutes: FastifyPluginAsync = async (fastify) => {
  mkdirSync(resolve(UPLOAD_DIR), { recursive: true });

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

  fastify.get<{ Params: { name: string } }>('/blobs/:name', async (req, reply) => {
    const p = resolve(UPLOAD_DIR, req.params.name);
    if (!p.startsWith(resolve(UPLOAD_DIR))) { reply.code(403); return; }
    if (!existsSync(p)) { reply.code(404); return; }
    reply.header('Cache-Control', 'public, max-age=2592000');
    return reply.send(createReadStream(p));
  });
};
