// Optional AI proxy. The PWA prefers calling cloud APIs directly with the
// user's own key; this route exists only for users who want a shared key or
// need to bypass CORS.
import type { FastifyPluginAsync } from 'fastify';

interface RecognizeBody {
  provider?: 'openai' | 'gemini';
  model?: string;
  imageUrls?: string[];   // either provided
  imageDataUrls?: string[]; // ...or inline data URLs
}

export const aiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: RecognizeBody }>('/ai/recognize', async (req, reply) => {
    const provider = req.body?.provider ?? (process.env.KEEPSAKE_AI_PROVIDER as any) ?? 'openai';
    const apiKey =
      provider === 'openai' ? process.env.OPENAI_API_KEY :
      provider === 'gemini' ? process.env.GEMINI_API_KEY :
      undefined;

    if (!apiKey) { reply.code(503); return { error: 'server proxy not configured' }; }

    // Minimal forwarder; production code should validate sizes and rate-limit.
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: req.body?.model ?? 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You list visible household items. Reply with JSON {items:[{name, qty, confidence}]} only.' },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'List visible items.' },
                ...((req.body?.imageDataUrls ?? []).map((u) => ({ type: 'image_url', image_url: { url: u } }))),
              ],
            },
          ],
          response_format: { type: 'json_object' },
        }),
      });
      const text = await res.text();
      reply.code(res.status).header('content-type', res.headers.get('content-type') ?? 'application/json');
      return text;
    }

    reply.code(501);
    return { error: `provider ${provider} not implemented in proxy` };
  });
};
