// Snapshot PvP ghost pool: a Cloudflare Pages Function at /api/ghosts, backed by D1.
//   GET  /api/ghosts?ver=<sim version>&round=<n>&player=<id>  -> { ghost: Snapshot | null }
//   POST /api/ghosts  { ver, player, name, snapshot }           -> { ok: true } or { error }
// Ghosts only meet fleets built on the same battle code (ver), at the same round.

import { cleanCallsign, cleanSnapshot, isPlayerId, MAX_ROUND } from '../../src/net/ghostRules';

// Just the parts of the D1 API this file uses (avoids a types dependency).
interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface D1 {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<unknown>;
}
interface Env { DB: D1 }
interface Ctx { request: Request; env: Env }

const MAX_BODY = 16_000; // bytes; a real snapshot is ~1-2 KB
const UPLOADS_PER_MINUTE = 12;
const KEEP_DAYS = 30;
const RECENT_POOL = 100; // pick at random among the newest fleets for that round

let schemaReady = false;
async function ensureSchema(db: D1) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ghosts (
      id TEXT PRIMARY KEY,
      ver TEXT NOT NULL,
      round INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      player TEXT NOT NULL,
      data TEXT NOT NULL,
      created INTEGER NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS ghosts_pick ON ghosts (ver, round, created)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ghosts_player ON ghosts (player, created)'),
  ]);
  schemaReady = true;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const isVersion = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]{4,40}$/.test(v);

export async function onRequestGet({ request, env }: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const ver = url.searchParams.get('ver');
  const round = Number(url.searchParams.get('round'));
  const player = url.searchParams.get('player') ?? '';
  if (!isVersion(ver) || !Number.isInteger(round) || round < 1 || round > MAX_ROUND) return json({ error: 'bad request' }, 400);
  await ensureSchema(env.DB);
  const row = await env.DB.prepare(
    `SELECT data FROM (
       SELECT data FROM ghosts WHERE ver = ?1 AND round = ?2 AND player <> ?3
       ORDER BY created DESC LIMIT ${RECENT_POOL}
     ) ORDER BY RANDOM() LIMIT 1`,
  ).bind(ver, round, player).first<{ data: string }>();
  return json({ ghost: row ? JSON.parse(row.data) : null });
}

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) return json({ error: 'too large' }, 413);
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: 'too large' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  if (!isVersion(body.ver)) return json({ error: 'bad version' }, 400);
  if (!isPlayerId(body.player)) return json({ error: 'bad player' }, 400);
  const name = cleanCallsign(body.name);
  if (!name) return json({ error: 'bad callsign' }, 400);
  const snap = cleanSnapshot(body.snapshot, name);
  if (typeof snap === 'string') return json({ error: snap }, 422);

  await ensureSchema(env.DB);
  const now = Date.now();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM ghosts WHERE player = ?1 AND created > ?2')
    .bind(body.player, now - 60_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= UPLOADS_PER_MINUTE) return json({ error: 'slow down' }, 429);

  await env.DB.prepare('INSERT OR REPLACE INTO ghosts (id, ver, round, wins, player, data, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(`${body.player}:${snap.id}`, body.ver, snap.round, snap.wins, body.player, JSON.stringify(snap), now).run();
  // Now and then, drop fleets older than a month so the pool stays fresh and small.
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM ghosts WHERE created < ?1').bind(now - KEEP_DAYS * 86_400_000).run();
  return json({ ok: true });
}
