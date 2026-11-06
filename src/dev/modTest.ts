// Dev tool: how much harder each run modifier makes a full run (bot-skill player vs bots).
//   npx esbuild src/dev/modTest.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/mods.mjs && node node_modules/.cache/mods.mjs [runs]
import { ARCHETYPES, botSnapshot } from '../game/bot';
import { MODS, toughenShip } from '../game/modifiers';
import { simulate } from '../sim/battle';
declare const process: { argv: string[] };
const RUNS = Number(process.argv[2]) || 120;
const foe = (seed: number, round: number) => botSnapshot(900000 + seed * 7919 + round * 104729, round);
function clearRate(mods: string[]) {
  let cleared = 0, n = 0;
  for (const a of ARCHETYPES) for (let i = 0; i < RUNS; i++) {
    let w = 0, lives = mods.includes('fragile') ? 3 : 5;
    for (let round = 1; w < 10 && lives > 0; round++) {
      const me = botSnapshot(5000 + i * 31, round, a.id, false, mods);
      const f = foe(i * 13 + 7, round);
      const opp = { ...f, fleet: f.fleet.map((x) => (x ? toughenShip(x, mods) : null)) };
      const res = simulate(me, opp).winner;
      if (res === 0) w++;
      if (res === 1) lives--;
    }
    if (w >= 10) cleared++;
    n++;
  }
  return (100 * cleared) / n;
}
const base = clearRate([]);
console.log(`no modifiers: ${base.toFixed(1)}% of runs cleared`);
for (const m of MODS) {
  const r = clearRate([m.id]);
  console.log(`${m.name.padEnd(16)} ${r.toFixed(1).padStart(5)}%  (${(r / base * 100 - 100).toFixed(0)}% clears)  bonus +${m.xp}% XP`);
}
const all = clearRate(MODS.map((m) => m.id));
console.log(`ALL           ${all.toFixed(1)}%`);
