// Snapshot PvP ghost pool: a Cloudflare Pages Function at /api/ghosts, backed by D1.
//   GET  /api/ghosts?ver=<sim version>&round=<n>&player=<id>  -> { ghost: Snapshot | null, gid?: number }
//   POST /api/ghosts  { ver, player, name, snapshot }           -> { ok: true } or { error }
// Ghosts only meet fleets built on the same battle code (ver), at the same round.
// `gid` identifies the ghost when reporting how a fight against it went (/api/results).

import { cleanCallsign, cleanSnapshot, isPlayerId, MAX_ROUND } from '../../src/net/ghostRules';
import { ensureSchema, isVersion, json, readBody, tooFast, type Ctx } from '../../src/net/db';

const UPLOADS_PER_MINUTE = 12;
const KEEP_DAYS = 30;
const RECENT_POOL = 100; // pick at random among the newest fleets for that round

export async function onRequestGet({ request, env }: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const ver = url.searchParams.get('ver');
  const round = Number(url.searchParams.get('round'));
  const player = url.searchParams.get('player') ?? '';
  if (!isVersion(ver) || !Number.isInteger(round) || round < 1 || round > MAX_ROUND) return json({ error: 'bad request' }, 400);
  await ensureSchema(env.DB);
  const row = await env.DB.prepare(
    `SELECT gid, data FROM (
       SELECT rowid AS gid, data FROM ghosts WHERE ver = ?1 AND round = ?2 AND player <> ?3
       ORDER BY created DESC LIMIT ${RECENT_POOL}
     ) ORDER BY RANDOM() LIMIT 1`,
  ).bind(ver, round, player).first<{ gid: number; data: string }>();
  return json(row ? { ghost: JSON.parse(row.data), gid: row.gid } : { ghost: null });
}

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response) return body;
  if (!isVersion(body.ver)) return json({ error: 'bad version' }, 400);
  if (!isPlayerId(body.player)) return json({ error: 'bad player' }, 400);
  const name = cleanCallsign(body.name);
  if (!name) return json({ error: 'bad callsign' }, 400);
  const snap = cleanSnapshot(body.snapshot, name);
  if (typeof snap === 'string') return json({ error: snap }, 422);

  await ensureSchema(env.DB);
  if (await tooFast(env.DB, 'ghosts', 'player', body.player, UPLOADS_PER_MINUTE)) return json({ error: 'slow down' }, 429);

  const now = Date.now();
  await env.DB.prepare('INSERT OR REPLACE INTO ghosts (id, ver, round, wins, player, data, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(`${body.player}:${snap.id}`, body.ver, snap.round, snap.wins, body.player, JSON.stringify(snap), now).run();
  // Now and then, drop fleets older than a month so the pool stays fresh and small.
  if (Math.random() < 0.02) {
    const cutoff = now - KEEP_DAYS * 86_400_000;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM ghosts WHERE created < ?1').bind(cutoff),
      env.DB.prepare('DELETE FROM ghost_fights WHERE created < ?1').bind(cutoff),
    ]);
  }
  return json({ ok: true });
}
