// /api/hl/* -> the live Hollow Lands colony Durable Object (worker "hollowlands-colony").
// See src/hollowlands/server/host.ts for the endpoints.

interface Env { COLONY?: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } } }

export const onRequest = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  if (!env.COLONY) {
    return new Response(JSON.stringify({ error: 'the colony is offline' }), { status: 503, headers: { 'content-type': 'application/json' } });
  }
  return env.COLONY.get(env.COLONY.idFromName('main')).fetch(request);
};
