// Moto Maze daily times and replays.
//   GET  /api/moto?day=YYYY-MM-DD&player=<id>&paths=<n>
//        -> { day, total, top: [{ rank, name, color, ms, tries, me }], me: { rank, ms, tries } | null,
//             runs?: [{ name, color, ms, path, me }] }   (runs = the fastest n replays, plus yours)
//   POST /api/moto { player, name, color, day, ms, path } -> { ok, rank, best, improved, total }
// Each rider keeps their best time per day. Runs are replayed against that day's maze and
// rejected if they go through walls, move too fast, or don't start and end in the right cells.

import { cleanCallsign, isPlayerId } from '../../src/net/ghostRules';
import { json, type Ctx, type D1 } from '../../src/net/db';
import { dayKey, genMaze, isDayKey } from '../../src/motomaze/maze';
import { MAX_SAMPLES, checkRun, decode } from '../../src/motomaze/path';

const TOP = 25;
const MAX_PATHS = 60;
const MAX_BODY = 60_000;
const COLORS = 12;

interface Row { player: string; name: string; color: number; ms: number; path: string; tries: number; updated: number }

let ready = false;
async function schema(db: D1) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS moto_runs (
      day TEXT NOT NULL, player TEXT NOT NULL, name TEXT NOT NULL, color INTEGER NOT NULL, ms INTEGER NOT NULL,
      path TEXT NOT NULL, tries INTEGER NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL,
      PRIMARY KEY (day, player)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS moto_runs_rank ON moto_runs (day, ms, updated)'),
  ]);
  ready = true;
}

const dayOpen = (day: string) => day === dayKey() || day === dayKey(Date.now() - 86_400_000);

async function rankOf(db: D1, day: string, ms: number, updated: number) {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM moto_runs WHERE day = ?1 AND (ms < ?2 OR (ms = ?2 AND updated < ?3))')
    .bind(day, ms, updated).first<{ n: number }>();
  return (r?.n ?? 0) + 1;
}

export async function onRequestGet({ request, env }: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const day = url.searchParams.get('day') ?? dayKey();
  const player = url.searchParams.get('player') ?? '';
  const paths = Math.max(0, Math.min(MAX_PATHS, Number(url.searchParams.get('paths') ?? 0) | 0));
  if (!isDayKey(day)) return json({ error: 'bad day' }, 400);
  await schema(env.DB);
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM moto_runs WHERE day = ?1').bind(day).first<{ n: number }>();
  const top = await env.DB.prepare(`SELECT player, name, color, ms, tries, updated FROM moto_runs WHERE day = ?1 ORDER BY ms, updated LIMIT ${TOP}`)
    .bind(day).all<Row>();
  let me = null;
  let mine: Row | null = null;
  if (isPlayerId(player)) {
    mine = await env.DB.prepare('SELECT * FROM moto_runs WHERE day = ?1 AND player = ?2').bind(day, player).first<Row>();
    if (mine) me = { rank: await rankOf(env.DB, day, mine.ms, mine.updated), ms: mine.ms, tries: mine.tries, name: mine.name };
  }
  const out: Record<string, unknown> = {
    day, total: total?.n ?? 0, me,
    top: top.results.map((r, i) => ({ rank: i + 1, name: r.name, color: r.color, ms: r.ms, tries: r.tries, me: r.player === player })),
  };
  if (paths > 0) {
    const rows = await env.DB.prepare(`SELECT player, name, color, ms, path, updated FROM moto_runs WHERE day = ?1 ORDER BY ms, updated LIMIT ${paths}`)
      .bind(day).all<Row>();
    const runs = rows.results.map((r) => ({ name: r.name, color: r.color, ms: r.ms, path: r.path, me: r.player === player }));
    if (mine && !runs.some((r) => r.me)) runs.push({ name: mine.name, color: mine.color, ms: mine.ms, path: mine.path, me: true });
    out.runs = runs;
  }
  return json(out);
}

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: 'too large' }, 413);
    body = JSON.parse(text);
    if (!body || typeof body !== 'object') throw new Error();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  if (!isPlayerId(body.player)) return json({ error: 'bad player' }, 400);
  const name = cleanCallsign(body.name);
  if (!name) return json({ error: 'bad name' }, 400);
  const color = Number(body.color);
  if (!Number.isInteger(color) || color < 0 || color >= COLORS) return json({ error: 'bad color' }, 400);
  if (!isDayKey(body.day) || !dayOpen(body.day)) return json({ error: 'day closed' }, 409);
  const ms = Number(body.ms);
  if (typeof body.path !== 'string') return json({ error: 'bad path' }, 400);
  const samples = decode(body.path);
  if (!samples || samples.length > MAX_SAMPLES) return json({ error: 'bad path' }, 400);
  const why = checkRun(genMaze(body.day), samples, ms);
  if (why) return json({ error: why }, 422);

  await schema(env.DB);
  const day = body.day, player = body.player, now = Date.now();
  const old = await env.DB.prepare('SELECT ms, tries, updated FROM moto_runs WHERE day = ?1 AND player = ?2').bind(day, player).first<Row>();
  if (old && now - old.updated < 3000) return json({ error: 'slow down' }, 429);
  let improved = false;
  if (!old) {
    improved = true;
    await env.DB.prepare('INSERT INTO moto_runs (day, player, name, color, ms, path, tries, created, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)')
      .bind(day, player, name, color, ms, body.path, now).run();
  } else if (ms < old.ms) {
    improved = true;
    await env.DB.prepare('UPDATE moto_runs SET name = ?3, color = ?4, ms = ?5, path = ?6, tries = tries + 1, updated = ?7 WHERE day = ?1 AND player = ?2')
      .bind(day, player, name, color, ms, body.path, now).run();
  } else {
    await env.DB.prepare('UPDATE moto_runs SET name = ?3, color = ?4, tries = tries + 1 WHERE day = ?1 AND player = ?2')
      .bind(day, player, name, color).run();
  }
  const best = improved ? ms : old!.ms;
  const updated = improved ? now : old!.updated;
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM moto_runs WHERE day = ?1').bind(day).first<{ n: number }>();
  return json({ ok: true, improved, best, rank: await rankOf(env.DB, day, best, updated), total: total?.n ?? 0 });
}
