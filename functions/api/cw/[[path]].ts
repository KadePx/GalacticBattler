// /api/cw/* -> the live Commonworld Durable Object (worker "commonworld-world").
// See src/commonworld/server/host.ts for the endpoints.

interface Env { WORLD?: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } } }

export const onRequest = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  if (!env.WORLD) {
    return new Response(JSON.stringify({ error: 'the world is offline' }), { status: 503, headers: { 'content-type': 'application/json' } });
  }
  return env.WORLD.get(env.WORLD.idFromName('main')).fetch(request);
};
