// Daily challenge leaderboard.
//   GET  /api/daily?day=YYYY-MM-DD&player=<id> -> { day, total, top: [...], me: { rank, ... } | null }
//   POST /api/daily { player, name, day, history, lives, cmd, fleet } -> { ok: true, rank }
// One score per pilot per day: the first finished attempt counts.

import { cleanCallsign, isPlayerId } from '../../src/net/ghostRules';
import { cleanDailyScore, dayKey, isDayKey } from '../../src/net/apiRules';
import { ensureSchema, json, readBody, tooFast, type Ctx, type D1 } from '../../src/net/db';

const TOP = 20;
const ORDER = 'wins DESC, lives DESC, battles ASC, created ASC';

interface Row { player: string; name: string; wins: number; lives: number; battles: number; cmd: string; fleet: string; relics: string | null; created: number }
const view = (r: Row, rank: number) => ({
  rank, name: r.name, wins: r.wins, lives: r.lives, battles: r.battles, cmd: r.cmd, fleet: JSON.parse(r.fleet),
  relics: r.relics ? JSON.parse(r.relics) : [],
});

/** Scores only count for today, or yesterday (a run that started before midnight UTC). */
function dayOpen(day: string) {
  const now = Date.now();
  return day === dayKey(now) || day === dayKey(now - 86_400_000);
}

async function rankOf(db: D1, day: string, r: Row) {
  const better = await db.prepare(
    `SELECT COUNT(*) AS n FROM daily WHERE day = ?1 AND (wins > ?2 OR (wins = ?2 AND (lives > ?3 OR (lives = ?3 AND
       (battles < ?4 OR (battles = ?4 AND created < ?5))))))`,
  ).bind(day, r.wins, r.lives, r.battles, r.created).first<{ n: number }>();
  return (better?.n ?? 0) + 1;
}

export async function onRequestGet({ request, env }: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const day = url.searchParams.get('day') ?? dayKey();
  const player = url.searchParams.get('player') ?? '';
  if (!isDayKey(day)) return json({ error: 'bad day' }, 400);
  await ensureSchema(env.DB);
  const top = await env.DB.prepare(`SELECT * FROM daily WHERE day = ?1 ORDER BY ${ORDER} LIMIT ${TOP}`).bind(day).all<Row>();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM daily WHERE day = ?1').bind(day).first<{ n: number }>();
  let me = null;
  if (isPlayerId(player)) {
    const mine = await env.DB.prepare('SELECT * FROM daily WHERE day = ?1 AND player = ?2').bind(day, player).first<Row>();
    if (mine) me = view(mine, await rankOf(env.DB, day, mine));
  }
  return json({ day, total: total?.n ?? 0, top: top.results.map((r, i) => view(r, i + 1)), me });
}

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response) return body;
  if (!isPlayerId(body.player)) return json({ error: 'bad player' }, 400);
  const name = cleanCallsign(body.name);
  if (!name) return json({ error: 'bad callsign' }, 400);
  const score = cleanDailyScore(body);
  if (typeof score === 'string') return json({ error: score }, 422);
  if (!dayOpen(score.day)) return json({ error: 'day closed' }, 409);

  await ensureSchema(env.DB);
  if (await tooFast(env.DB, 'daily', 'player', body.player, 5)) return json({ error: 'slow down' }, 429);
  const row: Row = {
    player: body.player, name, wins: score.wins, lives: score.lives, battles: score.battles,
    cmd: score.cmd, fleet: JSON.stringify(score.fleet), relics: JSON.stringify(score.relics), created: Date.now(),
  };
  await env.DB.prepare('INSERT OR IGNORE INTO daily (day, player, name, wins, lives, battles, cmd, fleet, relics, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)')
    .bind(score.day, row.player, row.name, row.wins, row.lives, row.battles, row.cmd, row.fleet, row.relics, row.created).run();
  const saved = await env.DB.prepare('SELECT * FROM daily WHERE day = ?1 AND player = ?2').bind(score.day, row.player).first<Row>();
  return json({ ok: true, rank: saved ? await rankOf(env.DB, score.day, saved) : null });
}
