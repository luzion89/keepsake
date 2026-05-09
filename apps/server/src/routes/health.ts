import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async () => ({
    ok: true,
    time: Date.now(),
    tunnel_url: fastify.tunnelUrl ?? null,
  }));
};
