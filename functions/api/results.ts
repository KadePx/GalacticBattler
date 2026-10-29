// How your ghosts are doing while you're away.
//   POST /api/results  { player, gid, won }  -> { ok: true }   (won = the reporting player beat the ghost)
//   GET  /api/results?player=<id>&since=<ms> -> { fights, ghostWins, recent: [{ opp, round, ghostWon, t }] }
// Each player can report a given ghost once; the ghost's owner is looked up from the pool.

import { cleanCallsign, isPlayerId } from '../../src/net/ghostRules';
import { ensureSchema, json, readBody, tooFast, type Ctx } from '../../src/net/db';

const REPORTS_PER_MINUTE = 20;
const RECENT = 6;

export async function onRequestGet({ request, env }: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const player = url.searchParams.get('player');
  const since = Number(url.searchParams.get('since') ?? 0);
  if (!isPlayerId(player) || !Number.isFinite(since) || since < 0) return json({ error: 'bad request' }, 400);
  await ensureSchema(env.DB);
  const totals = await env.DB.prepare('SELECT COUNT(*) AS fights, COALESCE(SUM(ghost_won), 0) AS wins FROM ghost_fights WHERE owner = ?1 AND created > ?2')
    .bind(player, since).first<{ fights: number; wins: number }>();
  const recent = await env.DB.prepare('SELECT opp, round, ghost_won, created FROM ghost_fights WHERE owner = ?1 AND created > ?2 ORDER BY created DESC LIMIT ?3')
    .bind(player, since, RECENT).all<{ opp: string; round: number; ghost_won: number; created: number }>();
  return json({
    fights: totals?.fights ?? 0,
    ghostWins: totals?.wins ?? 0,
    recent: recent.results.map((r) => ({ opp: r.opp, round: r.round, ghostWon: !!r.ghost_won, t: r.created })),
  });
}

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response) return body;
  if (!isPlayerId(body.player)) return json({ error: 'bad player' }, 400);
  if (typeof body.gid !== 'number' || !Number.isInteger(body.gid) || body.gid < 1) return json({ error: 'bad ghost' }, 400);
  if (typeof body.won !== 'boolean' && body.won !== null) return json({ error: 'bad result' }, 400);
  const name = cleanCallsign(body.name) ?? 'A PILOT';

  await ensureSchema(env.DB);
  if (await tooFast(env.DB, 'ghost_fights', 'reporter', body.player, REPORTS_PER_MINUTE)) return json({ error: 'slow down' }, 429);
  const ghost = await env.DB.prepare('SELECT player, round FROM ghosts WHERE rowid = ?1').bind(body.gid).first<{ player: string; round: number }>();
  if (!ghost) return json({ ok: true }); // the ghost expired; nothing to credit
  if (ghost.player === body.player) return json({ error: 'own ghost' }, 400);
  // A draw (won: null) counts as a fight the ghost didn't win.
  await env.DB.prepare('INSERT OR IGNORE INTO ghost_fights (gid, owner, reporter, opp, round, ghost_won, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(body.gid, ghost.player, body.player, name, ghost.round, body.won === false ? 1 : 0, Date.now()).run();
  return json({ ok: true });
}
