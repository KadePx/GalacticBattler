// Private household planner (/home/): shared calendar, meal plan, recipes and grocery list.
//   GET  /api/home?since=<ms> -> { me, now, items: [{ id, kind, data, updated, by, deleted }] }
//   POST /api/home { ops: [{ id, kind, data } | { id, del: true }] } -> { ok, now }
// Everything is a small JSON item, last write wins. The page works out the rest.
//
// Sign-in is Cloudflare Access. The Access rule on /home and /api/home decides who gets in; this
// function also checks the Access token itself, so the *.pages.dev copy of the site is no way round.
// Needs two Pages variables: ACCESS_TEAM_DOMAIN (like "name.cloudflareaccess.com") and ACCESS_AUD
// (the Access application's audience tag). Without them every request is refused.

import { json, type D1 } from '../../src/net/db';
import { whoIs, type AccessEnv } from '../../src/home/access';

interface Env extends AccessEnv { DB: D1 }
interface Ctx { request: Request; env: Env }
interface Row { id: string; kind: string; data: string; updated: number; by: string; deleted: number }

const KINDS = new Set(['person', 'event', 'day', 'recipe', 'meal', 'grocery', 'trip', 'prefs']);
const MAX_BODY = 300_000;
const MAX_ITEM = 20_000;
const MAX_OPS = 300;

let ready = false;
async function schema(db: D1) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS home_items (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL,
      by TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS home_items_updated ON home_items (updated)'),
  ]);
  ready = true;
}

const denied = () => json({ error: 'sign in' }, 401);

export async function onRequestGet({ request, env }: Ctx): Promise<Response> {
  const me = await whoIs(request, env);
  if (!me) return denied();
  await schema(env.DB);
  const since = Math.max(0, Number(new URL(request.url).searchParams.get('since') ?? 0) || 0);
  const now = Date.now();
  const rows = since
    ? await env.DB.prepare('SELECT * FROM home_items WHERE updated >= ?1').bind(since).all<Row>()
    : await env.DB.prepare('SELECT * FROM home_items WHERE deleted = 0').all<Row>();
  return json({
    me, now,
    items: rows.results.map((r) => ({ id: r.id, kind: r.kind, data: JSON.parse(r.data), updated: r.updated, by: r.by, deleted: !!r.deleted })),
  });
}

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  const me = await whoIs(request, env);
  if (!me) return denied();
  let body: { ops?: unknown };
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: 'too large' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  if (!Array.isArray(body.ops) || body.ops.length > MAX_OPS) return json({ error: 'bad ops' }, 400);
  await schema(env.DB);
  const now = Date.now();
  const stmts = [];
  for (const raw of body.ops) {
    const op = raw as { id?: unknown; kind?: unknown; data?: unknown; del?: unknown };
    if (typeof op.id !== 'string' || !op.id || op.id.length > 160) return json({ error: 'bad id' }, 400);
    if (op.del) {
      stmts.push(env.DB.prepare("UPDATE home_items SET deleted = 1, data = '{}', updated = ?2, by = ?3 WHERE id = ?1").bind(op.id, now, me));
      continue;
    }
    if (typeof op.kind !== 'string' || !KINDS.has(op.kind)) return json({ error: 'bad kind' }, 400);
    if (!op.data || typeof op.data !== 'object' || Array.isArray(op.data)) return json({ error: 'bad data' }, 400);
    const data = JSON.stringify(op.data);
    if (data.length > MAX_ITEM) return json({ error: 'item too large' }, 413);
    stmts.push(env.DB.prepare(`INSERT INTO home_items (id, kind, data, updated, by, deleted) VALUES (?1, ?2, ?3, ?4, ?5, 0)
      ON CONFLICT (id) DO UPDATE SET kind = ?2, data = ?3, updated = ?4, by = ?5, deleted = 0`).bind(op.id, op.kind, data, now, me));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, now });
}
