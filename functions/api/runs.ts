// Finished runs from real players, for balance.
//   POST /api/runs { ver, player, run: RunLog }  -> { ok: true }
//   GET  /api/runs?ver=<sim version>&days=<n>    -> aggregate stats (no player ids)
// GET reports, for runs on this battle-code version: overall numbers, and per ship /
// commander / relic how often it was in the final fleet and how those runs did.

import { isPlayerId } from '../../src/net/ghostRules';
import { cleanRunLog } from '../../src/net/apiRules';
import { ensureSchema, isVersion, json, readBody, tooFast, type Ctx } from '../../src/net/db';

const LOGS_PER_MINUTE = 6;

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response) return body;
  if (!isVersion(body.ver)) return json({ error: 'bad version' }, 400);
  if (!isPlayerId(body.player)) return json({ error: 'bad player' }, 400);
  const run = cleanRunLog(body.run);
  if (typeof run === 'string') return json({ error: run }, 422);
  await ensureSchema(env.DB);
  if (await tooFast(env.DB, 'runs', 'player', body.player, LOGS_PER_MINUTE)) return json({ error: 'slow down' }, 429);
  // Endless runs are logged again when they finally end, so later logs replace earlier ones.
  await env.DB.prepare(`INSERT OR REPLACE INTO runs (id, ver, player, mode, cmd, passive, wins, lives, battles, history, endless, fleet, relics, created)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`)
    .bind(`${body.player}:${run.runId}`, body.ver, body.player, run.mode, run.cmd, run.passive, run.wins, run.lives,
      run.history.length, run.history, run.endless ? 1 : 0, JSON.stringify(run.fleet), JSON.stringify(run.relics), Date.now())
    .run();
  return json({ ok: true });
}

interface Row { cmd: string | null; passive: string | null; wins: number; history: string; fleet: string; relics: string; mode: string }
interface Agg { runs: number; wins: number; cleared: number }
const add = (m: Record<string, Agg>, k: string, cleared: boolean, wins: number) => {
  const a = (m[k] ??= { runs: 0, wins: 0, cleared: 0 });
  a.runs++;
  a.wins += wins;
  if (cleared) a.cleared++;
};
const table = (m: Record<string, Agg>) =>
  Object.entries(m)
    .map(([id, a]) => ({ id, runs: a.runs, avgWins: +(a.wins / a.runs).toFixed(2), clearPct: Math.round((100 * a.cleared) / a.runs) }))
    .sort((x, y) => y.runs - x.runs);

export async function onRequestGet({ request, env }: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const ver = url.searchParams.get('ver');
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 30));
  if (ver !== null && !isVersion(ver)) return json({ error: 'bad version' }, 400);
  await ensureSchema(env.DB);
  const since = Date.now() - days * 86_400_000;
  const rows = ver
    ? await env.DB.prepare('SELECT cmd, passive, wins, history, fleet, relics, mode FROM runs WHERE ver = ?1 AND created > ?2 LIMIT 20000').bind(ver, since).all<Row>()
    : await env.DB.prepare('SELECT cmd, passive, wins, history, fleet, relics, mode FROM runs WHERE created > ?1 LIMIT 20000').bind(since).all<Row>();
  const ships: Record<string, Agg> = {};
  const cmds: Record<string, Agg> = {};
  const relics: Record<string, Agg> = {};
  let totalWins = 0;
  let cleared = 0;
  const reached = Array(11).fill(0); // runs whose (pre-endless) wins reached at least N
  for (const r of rows.results) {
    // Score the base run only: wins before endless (capped at 10), so endless doesn't skew it.
    const wins = Math.min(10, r.wins);
    const won = wins >= 10;
    totalWins += wins;
    if (won) cleared++;
    for (let n = 0; n <= wins; n++) reached[n]++;
    for (const def of new Set((JSON.parse(r.fleet) as [string, number][]).map((f) => f[0]))) add(ships, def, won, wins);
    if (r.cmd) add(cmds, `${r.cmd}.${r.passive ?? 'a'}`, won, wins);
    for (const id of new Set(JSON.parse(r.relics) as string[])) add(relics, id, won, wins);
  }
  const n = rows.results.length;
  return json({
    ver, days, runs: n,
    avgWins: n ? +(totalWins / n).toFixed(2) : 0,
    clearPct: n ? Math.round((100 * cleared) / n) : 0,
    reachedPct: reached.map((c) => (n ? Math.round((100 * c) / n) : 0)),
    ships: table(ships), commanders: table(cmds), relics: table(relics),
  });
}
