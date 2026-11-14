// /api/hl/* -> the live Hollow Lands keepers (worker "hollowlands-colony"): one Durable Object
// per colony (/api/hl/c/<id>/...) and one for the region (/api/hl/region).
// See src/hollowlands/server/host.ts and region.ts for the endpoints.

interface NS { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } }
interface Env { COLONY?: NS; REGION?: NS }

export const onRequest = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  const off = (): Response => new Response(JSON.stringify({ error: 'the world is offline' }), { status: 503, headers: { 'content-type': 'application/json' } });
  if (!env.COLONY || !env.REGION) return off();
  // never let an outside request pose as one keeper talking to another
  const headers = new Headers(request.headers);
  headers.delete('x-hl-internal');
  const clean = new Request(request, { headers });
  const path = new URL(request.url).pathname;
  const m = path.match(/\/api\/hl\/c\/([a-z0-9]{1,12})\//);
  if (m) return env.COLONY.get(env.COLONY.idFromName(m[1])).fetch(clean);
  if (/\/api\/hl\/region(\/[a-z]+)?\/?$/.test(path)) return env.REGION.get(env.REGION.idFromName('region')).fetch(clean);
  return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
};
