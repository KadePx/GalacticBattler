// /commonworld/c/<id>: a share link for one people. Link previews read the title, description
// and map image here; visitors are sent straight on to the world with that people open.

interface Env { WORLD?: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } } }

interface CivSummary {
  id: number; name: string; alive: boolean; born: number; died: number | null; year: number; pop: number; setts: number; peak: number;
  founder: boolean; byName: string; motto: string; values: string[]; age: string; faith: string | null; capital: string | null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : n >= 10000 ? `${Math.round(n / 1000)},000` : n.toLocaleString('en-US'));

export const onRequest = async ({ request, env, params }: { request: Request; env: Env; params: { id: string } }): Promise<Response> => {
  const id = Number(params.id);
  const origin = new URL(request.url).origin;
  const target = `/commonworld/?civ=${Number.isInteger(id) ? id : ''}`;
  let c: CivSummary | null = null;
  if (env.WORLD && Number.isInteger(id)) {
    try {
      const r = await env.WORLD.get(env.WORLD.idFromName('main')).fetch(new Request(`${origin}/api/cw/civ?id=${id}`));
      if (r.ok) c = (await r.json()) as CivSummary;
    } catch { c = null; }
  }
  const title = c ? `The ${c.name} · Commonworld` : 'Commonworld';
  const desc = !c
    ? 'One shared world where peoples rise, trade, fight and fall, fifteen years every hour.'
    : c.alive
      ? `${c.founder ? `Founded by ${c.byName || 'a visitor'} in ${c.born} AW` : `An ancient people since ${c.born} AW`}. Now ${fmt(c.pop)} people in ${c.setts} ${c.setts === 1 ? 'settlement' : 'settlements'}, in the ${c.age} Age${c.faith ? `, keeping ${c.faith}` : ''}.${c.motto ? ` “${c.motto}”` : ''}`
      : `${c.born}–${c.died} AW. At their height they numbered ${fmt(c.peak)}. Their story is in the chronicle.`;
  const img = c ? `${origin}/api/cw/og?id=${c.id}&y=${Math.floor(c.year / 10)}` : `${origin}/thumbs/commonworld.jpg`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Commonworld">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${origin}/commonworld/c/${id}">
<meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${img}">
<meta http-equiv="refresh" content="0; url=${target}">
<style>body{background:#0a0d14;color:#eef1f7;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0}a{color:#a5b0ff}</style>
</head><body><p><a href="${target}">Opening the world…</a></p><script>location.replace(${JSON.stringify(target)})</script></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
};
