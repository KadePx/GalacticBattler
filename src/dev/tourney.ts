// Dev-only balance tools. Not imported by the game. From the browser console:
//   const t = await import('/src/dev/tourney.ts'); await t.tourney()
import { ARCHETYPES, botSnapshot } from '../game/bot';
import { simulate } from '../sim/battle';

/**
 * Difficulty check: a "player" who shops exactly like a bot (but without the bots'
 * bonus scrap) plays full runs against real bot opponents. Returns how often each
 * archetype reaches 10 wins before losing 5 hull. Real players should beat this.
 */
export function runs(N = 200) {
  const out: Record<string, string> = {};
  for (const a of ARCHETYPES) {
    let cleared = 0;
    let winsTotal = 0;
    for (let i = 0; i < N; i++) {
      let wins = 0;
      let lives = 5;
      for (let round = 1; wins < 10 && lives > 0; round++) {
        const me = botSnapshot(5000 + i * 31, round, a.id, false);
        const foe = botSnapshot(777000 + i * 97 + round * 13, round);
        const w = simulate(me, foe).winner;
        if (w === 0) wins++;
        if (w === 1) lives--;
      }
      if (wins >= 10) cleared++;
      winsTotal += wins;
    }
    out[a.id] = `${Math.round((100 * cleared) / N)}% clear, avg ${(winsTotal / N).toFixed(1)} wins`;
  }
  return out;
}

/** Each archetype vs random bots at several rounds; plus per-ship win rates and fight length. */
export function tourney(N = 150, rounds = [4, 7, 10]) {
  const out: Record<string, Record<string, number>> = {};
  const ticks: Record<string, string> = {};
  const shipW: Record<string, number> = {};
  const shipP: Record<string, number> = {};
  let draws = 0;
  let games = 0;
  for (const round of rounds) {
    const row: Record<string, number> = {};
    let ts = 0;
    let tn = 0;
    for (const a of ARCHETYPES) {
      let w = 0;
      for (let i = 0; i < N; i++) {
        const A = botSnapshot(10000 + i * 13 + round, round, a.id);
        const B = botSnapshot(90000 + i * 7 + round, round);
        const r = simulate(A, B);
        ts += r.ticks;
        tn++;
        games++;
        if (r.winner === 0) w++;
        if (r.winner === -1) draws++;
        for (const [snap, side] of [[A, 0], [B, 1]] as const) {
          for (const f of snap.fleet) {
            if (!f) continue;
            shipP[f.def] = (shipP[f.def] ?? 0) + 1;
            if (r.winner === side) shipW[f.def] = (shipW[f.def] ?? 0) + 1;
          }
        }
      }
      row[a.id] = Math.round((100 * w) / N);
    }
    out[`r${round}`] = row;
    ticks[`r${round}`] = (ts / tn).toFixed(1);
  }
  const rate = (k: string) => (shipW[k] ?? 0) / shipP[k];
  const ships = Object.keys(shipP).sort((x, y) => rate(y) - rate(x)).map((k) => `${k} ${Math.round(100 * rate(k))}`).join(', ');
  return { archetypes: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, JSON.stringify(v)])), ticks, ships, drawPct: ((100 * draws) / games).toFixed(1) };
}
